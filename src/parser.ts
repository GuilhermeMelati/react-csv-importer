import Papa from 'papaparse';
import { ReadableWebToNodeStream } from 'readable-web-to-node-stream';

const BOM_CODE = 65279; // 0xFEFF

export interface CustomizablePapaParseConfig {
  delimiter?: Papa.ParseConfig['delimiter'];
  newline?: Papa.ParseConfig['newline'];
  quoteChar?: Papa.ParseConfig['quoteChar'];
  escapeChar?: Papa.ParseConfig['escapeChar'];
  comments?: Papa.ParseConfig['comments'];
  skipEmptyLines?: Papa.ParseConfig['skipEmptyLines'];
  delimitersToGuess?: Papa.ParseConfig['delimitersToGuess'];
  chunkSize?: Papa.ParseConfig['chunkSize'];
  encoding?: Papa.ParseConfig['encoding'];
}

export interface PreviewReport {
  file: File;
  firstChunk: string;
  firstRows: string[][]; // always PREVIEW_ROWS count
  isSingleLine: boolean;
  parseWarning?: Papa.ParseError;
}

// success/failure report from the preview parse attempt
export type PreviewResults =
  | {
      parseError: Error | Papa.ParseError;
      file: File;
    }
  | ({
      parseError: undefined;
    } & PreviewReport);

export const PREVIEW_ROW_COUNT = 5;

export type FieldAssignmentMap = { [name: string]: number | undefined };

export type BaseRow = { [name: string]: unknown };

export type ParseCallback<Row extends BaseRow> = (
  rows: Row[],
  info: {
    startIndex: number;
  }
) => void | Promise<void>;

// polyfill as implemented in https://github.com/eligrey/Blob.js/blob/master/Blob.js#L653
// (this is for Safari pre v14.1)
function streamForBlob(blob: Blob) {
  if (blob.stream) {
    return blob.stream();
  }

  const res = new Response(blob);
  if (res.body) {
    return res.body;
  }

  throw new Error('This browser does not support client-side file reads');
}

// perform in-place BOM clean
function cleanLeadingBOM(row: string[]) {
  if (row.length > 0 && row[0].charCodeAt(0) === BOM_CODE) {
    row[0] = row[0].substring(1);
  }
}

export function parsePreview(
  file: File,
  customConfig: CustomizablePapaParseConfig
): Promise<PreviewResults> {
  // wrap synchronous errors in promise
  return new Promise<PreviewResults>((resolve) => {
    let firstChunk: string | null = null;
    let firstWarning: Papa.ParseError | undefined = undefined;
    const rowAccumulator: string[][] = [];

    function reportSuccess() {
      // PapaParse normally complains first anyway, but might as well flag it
      if (rowAccumulator.length === 0) {
        return {
          parseError: new Error('File is empty'),
          file
        };
      }

      // remember whether this file has only one line
      const isSingleLine = rowAccumulator.length === 1;

      // fill preview with blanks if needed
      while (rowAccumulator.length < PREVIEW_ROW_COUNT) {
        rowAccumulator.push([]);
      }

      resolve({
        file,
        parseError: undefined,
        parseWarning: firstWarning || undefined,
        firstChunk: firstChunk || '',
        firstRows: rowAccumulator,
        isSingleLine
      });
    }

    // use our own multibyte-safe streamer, bail after first chunk
    // (this used to add skipEmptyLines but that was hiding possible parse errors)
    // @todo close the stream
    // @todo wait for upstream multibyte fix in PapaParse: https://github.com/mholt/PapaParse/issues/908
    const nodeStream = new ReadableWebToNodeStream(streamForBlob(file));
    nodeStream.setEncoding(customConfig.encoding || 'utf8');

    Papa.parse(nodeStream, {
      ...customConfig,

      chunkSize: 10000, // not configurable, preview only @todo make configurable
      preview: PREVIEW_ROW_COUNT,

      error: (error) => {
        resolve({
          parseError: error,
          file
        });
      },
      beforeFirstChunk: (chunk) => {
        firstChunk = chunk;
      },
      chunk: ({ data, errors }, parser) => {
        let skipBOM = true;
        data.forEach((row) => {
          const stringRow = (row as unknown[]).map((item) =>
            typeof item === 'string' ? item : ''
          );

          // perform BOM skip on first value
          if (skipBOM) {
            // even if this row is zero-length, no need to skip on next one
            skipBOM = false;
            cleanLeadingBOM(stringRow);
          }

          rowAccumulator.push(stringRow);
        });

        if (errors.length > 0 && !firstWarning) {
          firstWarning = errors[0];
        }

        // finish parsing after first chunk
        nodeStream.pause(); // parser does not pause source stream, do it here explicitly
        parser.abort();

        reportSuccess();
      },
      complete: reportSuccess
    });
  }).catch((error) => {
    return {
      parseError: error, // delegate message display to UI logic
      file
    };
  });
}

export interface ParserInput {
  file: File;
  papaParseConfig: CustomizablePapaParseConfig;
  hasHeaders: boolean;
  fieldAssignments: FieldAssignmentMap;
}

export function processFile<Row extends BaseRow>(
  input: ParserInput,
  reportProgress: (deltaCount: number) => void,
  callback: ParseCallback<Row>
): Promise<void> {
  const { file, hasHeaders, papaParseConfig, fieldAssignments } = input;
  const fieldNames = Object.keys(fieldAssignments);

  // wrap synchronous errors in promise
  return new Promise<void>((resolve, reject) => {
    // skip first line if needed
    let skipLine = hasHeaders;
    let skipBOM = !hasHeaders;
    let processedCount = 0;

    // use our own multibyte-safe decoding streamer
    // @todo wait for upstream multibyte fix in PapaParse: https://github.com/mholt/PapaParse/issues/908
    const nodeStream = new ReadableWebToNodeStream(streamForBlob(file));
    nodeStream.setEncoding(papaParseConfig.encoding || 'utf8');

    Papa.parse(nodeStream, {
      ...papaParseConfig,
      chunkSize: papaParseConfig.chunkSize || 10000, // our own preferred default

      error: (error) => {
        reject(error);
      },
      chunk: ({ data }, parser) => {
        // pause to wait until the rows are consumed
        nodeStream.pause(); // parser does not pause source stream, do it here explicitly
        parser.pause();

        const skipped = skipLine && data.length > 0;

        const rows = (skipped ? data.slice(1) : data).map((row) => {
          const stringRow = (row as unknown[]).map((item) =>
            typeof item === 'string' ? item : ''
          );

          // perform BOM skip on first value
          if (skipBOM) {
            // even if this row is zero-length, no need to skip on next one
            skipBOM = false;
            cleanLeadingBOM(stringRow);
          }

          const record = {} as { [name: string]: string | undefined };

          fieldNames.forEach((fieldName) => {
            const columnIndex = fieldAssignments[fieldName];
            if (columnIndex !== undefined) {
              record[fieldName] = stringRow[columnIndex];
            }
          });

          return record as Row; // @todo look into a more precise setup
        });

        // clear line skip flag if there was anything to skip
        if (skipped) {
          skipLine = false;
        }

        // info snapshot for processing callback
        const info = {
          startIndex: processedCount
        };

        processedCount += rows.length;

        // @todo collect errors
        reportProgress(rows.length);

        // wrap sync errors in promise
        // (avoid invoking callback if there are no rows to consume)
        const whenConsumed = new Promise<void>((resolve) => {
          const result = rows.length ? callback(rows, info) : undefined;

          // introduce delay to allow a frame render
          setTimeout(() => resolve(result), 0);
        });

        // unpause parsing when done
        whenConsumed.then(
          () => {
            nodeStream.resume();
            parser.resume();
          },
          () => {
            // @todo collect errors
            nodeStream.resume();
            parser.resume();
          }
        );
      },
      complete: () => {
        resolve();
      }
    });
  });
}