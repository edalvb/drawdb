import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const TransformContext = createContext(null);

/**
 * Stable context that never changes identity across pan/zoom updates. It only
 * exposes `setTransform` and a `transformRef` whose `.current` always mirrors
 * the latest transform. Consumers that merely need the transform value at a
 * point in time (e.g. when creating a table/area/note) can read it from here
 * without re-rendering on every pan/zoom event.
 */
export const TransformRefContext = createContext(null);

export default function TransformContextProvider({ children }) {
  const [transform, setTransformInternal] = useState({
    zoom: 1,
    pan: { x: 0, y: 0 },
  });

  const transformRef = useRef(transform);

  // Keep the ref aligned with the committed state. The updater below also
  // assigns it for same-tick freshness; this guarantees correctness even if a
  // render is discarded.
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  /**
   * @type {typeof DrawDB.TransformContext["setTransform"]}
   */
  const setTransform = useCallback((actionOrValue) => {
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const findFirstNumber = (...values) =>
      values.find((value) => typeof value === "number" && !isNaN(value));

    setTransformInternal((prev) => {
      let resolved = actionOrValue;
      if (typeof resolved === "function") {
        resolved = resolved(prev);
      }

      const next = {
        zoom: clamp(findFirstNumber(resolved.zoom, prev.zoom, 1), 0.02, 5),
        pan: {
          x: findFirstNumber(resolved.pan?.x, prev.pan?.x, 0),
          y: findFirstNumber(resolved.pan?.y, prev.pan?.y, 0),
        },
      };

      // Keep the ref in sync so non-subscribing consumers always read the
      // latest value. `next` is derived purely from `prev`, so this assignment
      // is idempotent even if React replays the updater.
      transformRef.current = next;
      return next;
    });
  }, []);

  // Stable identity: only changes if `setTransform` changes (it never does).
  const refValue = useMemo(
    () => ({ setTransform, transformRef }),
    [setTransform],
  );

  const value = useMemo(
    () => ({ transform, setTransform, transformRef }),
    [transform, setTransform],
  );

  return (
    <TransformRefContext.Provider value={refValue}>
      <TransformContext.Provider value={value}>
        {children}
      </TransformContext.Provider>
    </TransformRefContext.Provider>
  );
}
