/* global importScripts, jsQR */
importScripts('../vendor/jsqr/jsQR.js');

self.onmessage = function (e) {
  const { buffer, width, height } = e.data;
  const clamped = new Uint8ClampedArray(buffer);
  const code = jsQR(clamped, width, height, {
    inversionAttempts: 'dontInvert',
  });

  if (!code) {
    self.postMessage({ found: false });
    return;
  }

  self.postMessage({
    found: true,
    data: code.data,
    location: {
      topLeftCorner: code.location.topLeftCorner,
      topRightCorner: code.location.topRightCorner,
      bottomRightCorner: code.location.bottomRightCorner,
      bottomLeftCorner: code.location.bottomLeftCorner,
    },
  });
};
