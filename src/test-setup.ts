import "@testing-library/jest-dom";

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({
      arc: () => {},
      beginPath: () => {},
      clearRect: () => {},
      closePath: () => {},
      drawImage: () => {},
      fill: () => {},
      fillRect: () => {},
      fillText: () => {},
      getImageData: (
        _x: number,
        _y: number,
        width: number,
        height: number,
      ) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      lineTo: () => {},
      measureText: () => ({ width: 0 }),
      moveTo: () => {},
      putImageData: () => {},
      restore: () => {},
      save: () => {},
      scale: () => {},
      setTransform: () => {},
      stroke: () => {},
      strokeRect: () => {},
      translate: () => {},
    }),
  });
}
