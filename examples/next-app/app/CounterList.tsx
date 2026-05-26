// SPDX-License-Identifier: Apache-2.0
'use client';
import { cn } from '@pinagent/ui/lib/utils';
import type { DragEvent } from 'react';
import { useState } from 'react';
import { Counter } from './Counter';

type Item = { label: string; description?: string };

export function CounterList({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function handleDragStart(e: DragEvent<HTMLDivElement>, i: number) {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== i) setOverIndex(i);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, i: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === i) {
      reset();
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      if (!moved) return prev;
      next.splice(i, 0, moved);
      return next;
    });
    reset();
  }

  function reset() {
    setDragIndex(null);
    setOverIndex(null);
  }

  return (
    <>
      {items.map((item, i) => {
        const isDragging = dragIndex === i;
        const isDropTarget = overIndex === i && dragIndex !== null && dragIndex !== i;
        return (
          <div
            key={item.label}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={reset}
            className={cn(
              'cursor-grab border-t-2 border-transparent transition-[opacity,border-color] duration-100',
              isDragging && 'opacity-40',
              isDropTarget && 'border-accent',
            )}
          >
            <Counter label={item.label} description={item.description} />
          </div>
        );
      })}
    </>
  );
}
