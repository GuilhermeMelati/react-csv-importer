import React, { useState, useMemo } from 'react';
import { useDrag } from 'react-use-gesture';

import { FieldAssignmentMap } from './parser';
import { DragState } from './ColumnDragState';
import { ColumnDragCard, Column } from './ColumnDragCard';
import { IconButton } from './IconButton';

import './ColumnDragSourceArea.scss';

const SOURCES_PAGE_SIZE = 5; // fraction of 10 for easier counting

// @todo readable status text if not mouse-drag
const SourceBox: React.FC<{
  hasHeaders: boolean;
  column: Column;
  fieldAssignments: FieldAssignmentMap;
  dragState: DragState | null;
  eventBinder: (column: Column) => ReturnType<typeof useDrag>;
  onSelect: (column: Column) => void;
  onUnassign: (column: Column) => void;
}> = ({
  hasHeaders,
  column,
  fieldAssignments,
  dragState,
  eventBinder,
  onSelect,
  onUnassign
}) => {
  const isDragged = dragState ? column === dragState.column : false;

  const isAssigned = useMemo(
    () =>
      Object.keys(fieldAssignments).some(
        (fieldName) => fieldAssignments[fieldName] === column.index
      ),
    [fieldAssignments, column]
  );

  const eventHandlers = useMemo(() => eventBinder(column), [
    eventBinder,
    column
  ]);

  return (
    <div className="ColumnDragSourceArea__box">
      <div {...(isAssigned ? {} : eventHandlers)}>
        <ColumnDragCard
          hasHeaders={hasHeaders}
          column={column}
          isShadow={isDragged || isAssigned}
          isDraggable={!dragState && !isDragged && !isAssigned}
        />
      </div>

      {/* tab order after column contents */}
      <div className="ColumnDragSourceArea__boxAction">
        {isAssigned ? (
          <IconButton
            label="Reset field"
            small
            type="replay"
            onClick={() => {
              onUnassign(column);
            }}
          />
        ) : (
          <IconButton
            focusOnly
            label="Select for assignment"
            disabled={!!dragState && dragState.column === column}
            small
            type="back"
            onClick={() => {
              onSelect(column);
            }}
          />
        )}
      </div>
    </div>
  );
};

// @todo current page indicator (dots)
export const ColumnDragSourceArea: React.FC<{
  hasHeaders: boolean;
  columns: Column[];
  fieldAssignments: FieldAssignmentMap;
  dragState: DragState | null;
  eventBinder: (column: Column) => ReturnType<typeof useDrag>;
  onSelect: (column: Column) => void;
  onUnassign: (column: Column) => void;
}> = ({
  hasHeaders,
  columns,
  fieldAssignments,
  dragState,
  eventBinder,
  onSelect,
  onUnassign
}) => {
  const [page, setPage] = useState<number>(0);
  const pageCount = Math.ceil(columns.length / SOURCES_PAGE_SIZE);

  const start = page * SOURCES_PAGE_SIZE;
  const pageContents = columns
    .slice(start, start + SOURCES_PAGE_SIZE)
    .map((column, columnIndex) => (
      <SourceBox
        key={columnIndex}
        hasHeaders={hasHeaders}
        column={column}
        fieldAssignments={fieldAssignments}
        dragState={dragState}
        eventBinder={eventBinder}
        onSelect={onSelect}
        onUnassign={onUnassign}
      />
    ));

  while (pageContents.length < SOURCES_PAGE_SIZE) {
    pageContents.push(
      <div
        key={pageContents.length}
        className="ColumnDragSourceArea__pageFiller"
      />
    );
  }

  return (
    <section className="ColumnDragSourceArea" aria-label="Columns to import">
      <div className="ColumnDragSourceArea__control">
        <IconButton
          label="Show previous columns"
          type="back"
          disabled={page === 0}
          onClick={() => {
            setPage((prev) => Math.max(0, prev - 1));
          }}
        />
      </div>
      <div
        className="ColumnDragSourceArea__page"
        aria-label={`Page ${page + 1}`}
      >
        {pageContents}
      </div>
      <div className="ColumnDragSourceArea__control">
        <IconButton
          label="Show next columns"
          type="forward"
          disabled={page === pageCount - 1}
          onClick={() => {
            setPage((prev) => Math.min(pageCount - 1, prev + 1));
          }}
        />
      </div>
    </section>
  );
};
