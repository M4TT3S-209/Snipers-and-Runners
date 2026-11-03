import { GestureRecognizer, type Gesture } from './gestureRecognizer';

/**
 * Verbindet den GestureRecognizer mit einem DOM-Element (Pointer-Events).
 * Es zählt nur der erste Finger. Gibt eine Funktion zum Abmelden zurück.
 */
export function attachGestures(element: HTMLElement, onGesture: (g: Gesture) => void): () => void {
  const rec = new GestureRecognizer();
  let pointerId: number | null = null;
  let raf = 0;

  const emit = (g: Gesture | null) => {
    if (g) onGesture(g);
  };

  const loop = () => {
    emit(rec.tick(performance.now()));
    raf = pointerId !== null ? requestAnimationFrame(loop) : 0;
  };

  const onDown = (e: PointerEvent) => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    element.setPointerCapture?.(e.pointerId);
    rec.down(e.clientX, e.clientY, performance.now());
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    emit(rec.move(e.clientX, e.clientY, performance.now()));
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    emit(rec.up(e.clientX, e.clientY, performance.now()));
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    emit(rec.cancel());
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);
  return () => {
    cancelAnimationFrame(raf);
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
  };
}
