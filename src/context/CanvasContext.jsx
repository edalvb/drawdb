import { useTransform } from "../hooks";
import { createContext, useCallback, useMemo, useRef, useState } from "react";
import { useEventListener, useResizeObserver } from "usehooks-ts";

export const CanvasContext = createContext({
  canvas: {
    screenSize: {
      x: 0,
      y: 0,
    },
    viewBox: new DOMRect(),
  },
  coords: {
    toDiagramSpace(coords) {
      return coords;
    },
    toScreenSpace(coords) {
      return coords;
    },
  },
  pointer: {
    spaces: {
      screen: {
        x: 0,
        y: 0,
      },
      diagram: {
        x: 0,
        y: 0,
      },
    },
    style: "default",
    setStyle() {},
  },
});

export function CanvasContextProvider({ children, ...attrs }) {
  const canvasWrapRef = useRef(null);
  const { transform } = useTransform();
  const canvasSize = useResizeObserver({
    ref: canvasWrapRef,
    box: "content-box",
  });
  const screenSize = useMemo(
    () => ({
      x: canvasSize.width ?? 0,
      y: canvasSize.height ?? 0,
    }),
    [canvasSize.height, canvasSize.width],
  );
  const viewBoxSize = useMemo(
    () => ({
      x: screenSize.x / transform.zoom,
      y: screenSize.y / transform.zoom,
    }),
    [screenSize.x, screenSize.y, transform.zoom],
  );
  const viewBox = useMemo(
    () =>
      new DOMRect(
        transform.pan.x - viewBoxSize.x / 2,
        transform.pan.y - viewBoxSize.y / 2,
        viewBoxSize.x,
        viewBoxSize.y,
      ),
    [transform.pan.x, transform.pan.y, viewBoxSize.x, viewBoxSize.y],
  );

  const toDiagramSpace = useCallback(
    (coord) => ({
      x:
        typeof coord.x === "number"
          ? (coord.x / screenSize.x) * viewBox.width + viewBox.left
          : undefined,
      y:
        typeof coord.y === "number"
          ? (coord.y / screenSize.y) * viewBox.height + viewBox.top
          : undefined,
    }),
    [
      screenSize.x,
      screenSize.y,
      viewBox.height,
      viewBox.left,
      viewBox.top,
      viewBox.width,
    ],
  );

  const toScreenSpace = useCallback(
    (coord) => ({
      x:
        typeof coord.x === "number"
          ? ((coord.x - viewBox.left) / viewBox.width) * screenSize.x
          : undefined,
      y:
        typeof coord.y === "number"
          ? ((coord.y - viewBox.top) / viewBox.height) * screenSize.y
          : undefined,
    }),
    [
      screenSize.x,
      screenSize.y,
      viewBox.height,
      viewBox.left,
      viewBox.top,
      viewBox.width,
    ],
  );

  // The pointer position is read at event/animation frequency but almost never
  // needs to *render* anything. Keeping it in a ref (instead of state) means a
  // bare pointer move no longer re-renders this provider — and therefore no
  // longer repaints the whole diagram. Components that need the live value read
  // it on demand through `pointer.spaces`.
  const pointerScreenRef = useRef({ x: 0, y: 0 });
  // Always points at the latest space-conversion helper so the on-demand
  // getters below convert with the current viewBox without being recreated.
  const toDiagramSpaceRef = useRef(toDiagramSpace);
  toDiagramSpaceRef.current = toDiagramSpace;

  const [pointerStyle, setPointerStyle] = useState("default");

  /**
   * @param {PointerEvent} e
   */
  const detectPointerMovement = useCallback((e) => {
    const targetElm = /** @type {HTMLElement | null} */ (e.currentTarget);
    if (!e.isPrimary || !targetElm) return;

    const canvasBounds = targetElm.getBoundingClientRect();

    pointerScreenRef.current = {
      x: e.clientX - canvasBounds.left,
      y: e.clientY - canvasBounds.top,
    };
  }, []);

  // Important for touch screen devices!
  useEventListener("pointerdown", detectPointerMovement, canvasWrapRef);

  useEventListener("pointermove", detectPointerMovement, canvasWrapRef);

  // Stable pointer API. `spaces` is a getter so reads always reflect the live
  // ref + current conversion; only `style` changes its enclosing object.
  const pointer = useMemo(
    () => ({
      get spaces() {
        const screen = pointerScreenRef.current;
        return {
          screen,
          diagram: toDiagramSpaceRef.current(screen),
        };
      },
      style: pointerStyle,
      setStyle: setPointerStyle,
    }),
    [pointerStyle],
  );

  const contextValue = useMemo(
    () => ({
      canvas: {
        screenSize,
        viewBox,
      },
      coords: {
        toDiagramSpace,
        toScreenSpace,
      },
      pointer,
    }),
    [screenSize, viewBox, toDiagramSpace, toScreenSpace, pointer],
  );

  return (
    <CanvasContext.Provider value={contextValue}>
      <div {...attrs} ref={canvasWrapRef}>
        {children}
      </div>
    </CanvasContext.Provider>
  );
}
