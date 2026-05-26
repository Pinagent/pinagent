'use client';
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
      {items.map((item, i) => (
        <div
          key={item.label}
          draggable
          onDragStart={(e) => handleDragStart(e, i)}
          onDragOver={(e) => handleDragOver(e, i)}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={reset}
          style={{
            opacity: dragIndex === i ? 0.4 : 1,
            cursor: 'grab',
            borderTop:
              overIndex === i && dragIndex !== null && dragIndex !== i
                ? '2px solid #4ade80'
                : '2px solid transparent',
            transition: 'opacity 120ms ease, border-color 120ms ease',
          }}
        >
          <Counter label={item.label} description={item.description} />
        </div>
      ))}
    </>
  );
}
