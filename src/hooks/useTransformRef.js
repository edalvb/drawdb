import { useContext } from "react";
import { TransformRefContext } from "../context/TransformContext";

/**
 * Reads the transform via a stable ref without subscribing to pan/zoom
 * updates. Use this in providers/components that only need the transform value
 * at a point in time (e.g. positioning a newly created element) so they don't
 * re-render on every pan/zoom frame.
 */
export default function useTransformRef() {
  return useContext(TransformRefContext);
}
