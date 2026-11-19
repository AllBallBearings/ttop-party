// Per-device rear camera calibration.
//
// Focal lengths (in pixels) are expressed for a 480 x 640 portrait image of the
// full 4:3 sensor. They come from 8th Wall's open-source engine
// (c8/geometry/intrinsics.cc, MIT License, Copyright (c) 8th Wall / Niantic),
// which calibrated each device. Device identification follows the same
// approach as 8th Wall's js-device / override.ts: Android model strings from
// the user agent (or UA client hints), and iPhone families from the physical
// screen height plus the GPU name where the browser still exposes it.
//
// Captures at other resolutions/aspect ratios are derived with
// Intrinsics.cropAndScale(), i.e. a 16:9 capture is a centre crop of the 4:3
// sensor that keeps the long side.

import { Intrinsics } from './camera-model.js';

const REF_W = 480;
const REF_H = 640;

export const DEFAULT_FOCAL_480x640 = 506.4104; // iPhone X; 8th Wall's default

const IOS_FOCALS = {
  // Keys are the family names returned by detectIosModel().
  'iPhone 5/5s/5c/SE': 546.5731,
  'iPhone 6/6s/7/8': 538.0105,
  'iPhone 6+/6s+/7+/8+': 525.9533,
  'iPhone X/XS/11Pro': 498.205,
  'iPhone XR/11': 488.1437,
  'iPhone XSMax/11ProMax': 489.6052,
  'iPhone 12/13/14': 477.786,
  'iPhone 12ProMax/14Plus': 496.0,
  'iPhone 14Pro/15/16': 449.4042,
  'iPhone 14ProMax/15Plus/15ProMax': 459.4768,
  // Uncalibrated newer sizes: closest calibrated wide camera.
  'iPhone 16Pro': 449.4042,
  'iPhone 16ProMax': 459.4768,
  iPhone: DEFAULT_FOCAL_480x640,
};

// Android: matched against the model string as a prefix (Samsung region suffixes
// such as SM-G960U1 are ignored).
const ANDROID_FOCALS = [
  ['Pixel 7 Pro', 521.6449], ['Pixel 7', 521.8225],
  ['Pixel 6 Pro', 701.1237], ['Pixel 6', 695.8949],
  ['Pixel 5a', 677.5731], ['Pixel 5', 672.6488],
  ['Pixel 4 XL', 514.814], ['Pixel 4', 511.2248],
  ['Pixel 3 XL', 514.4164], ['Pixel 3', 519.9731],
  ['Pixel 2 XL', 490.7689], ['Pixel 2', 499.276],
  ['Pixel XL', 499.2098], ['Pixel', 491.7793],
  ['SM-G360', 575.0482], ['SM-J710', 690.9029], ['SM-G900', 723.094],
  ['SM-G920', 625.4912], ['SM-G925', 649.8869], ['SM-G930', 491.4958], ['SM-G935', 511.5746],
  ['SM-G950', 508.2721], ['SM-G955', 508.1794], ['SM-G960', 499.9801], ['SM-G965', 499.2632],
  ['SM-G970', 337.2781], ['SM-G973', 492.1022], ['SM-G975', 494.8447],
  ['SM-N950', 645.3651], ['SM-N960', 672.9767], ['SM-N975', 485.4488],
  ['SM-G991', 488.1016], ['SM-G998', 465.0067], ['SM-S906', 439.8777],
  ['SM-F926', 412.034], ['SM-F711', 498.8212], ['SM-T580', 512.0151],
  ['KB2005', 387.9355], ['BE2026', 443.73], ['LE2115', 456.029], ['LE2125', 462.9853],
  ['Nexus 6P', 502.3116], ['Nexus 6', 538.1735], ['Nexus 5X', 479.3516],
  ['Nexus 5', 559.9671], ['Nexus 4', 581.1556],
  ['MI MIX 2', 493.5102], ['Redmi 4X', 561.6292],
  ['EML-', 488.2982], ['ANE-', 488.6114], ['VOG-', 514.1215],
  ['FRD-', 498.8813], ['STF-', 512.9015], ['MHA-', 521.2284], ['ALP-', 531.881],
];

function screenHeightPx() {
  if (typeof window === 'undefined' || !window.screen) return 0;
  const { width, height } = window.screen;
  return Math.round(Math.max(width, height) * (window.devicePixelRatio || 1));
}

/** Best-effort identification of iPhone family from screen size (see 8th Wall override.ts). */
export function detectIosModel(heightPx = screenHeightPx()) {
  switch (heightPx) {
    case 1136: return 'iPhone 5/5s/5c/SE';
    case 1334: return 'iPhone 6/6s/7/8';
    case 1624: case 1792: return 'iPhone XR/11';
    case 2001: case 2208: return 'iPhone 6+/6s+/7+/8+';
    case 2436: return 'iPhone X/XS/11Pro';
    case 2079: case 2532: return 'iPhone 12/13/14';
    case 2778: return 'iPhone 12ProMax/14Plus';
    case 2556: return 'iPhone 14Pro/15/16';
    case 2796: return 'iPhone 14ProMax/15Plus/15ProMax';
    case 2622: return 'iPhone 16Pro';
    case 2868: return 'iPhone 16ProMax';
    case 2688: return 'iPhone XSMax/11ProMax';
    default: return 'iPhone';
  }
}

function androidModelFromUa(ua) {
  const m = /Android [^;)]*;\s*([^;)]+?)(?:\s+Build\/|\))/.exec(ua);
  return m ? m[1].trim() : '';
}

/**
 * Identify the device. Returns {platform, model}. Uses UA client hints when
 * available (Chrome reduces the Android UA model to "K").
 */
export async function detectDevice() {
  if (typeof navigator === 'undefined') return { platform: 'unknown', model: '' };
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1);
  if (isIos) return { platform: 'ios', model: /iPad|Macintosh/.test(ua) ? 'iPad' : detectIosModel() };
  if (/Android/.test(ua)) {
    let model = androidModelFromUa(ua);
    if ((!model || model === 'K') && navigator.userAgentData?.getHighEntropyValues) {
      try {
        const hints = await navigator.userAgentData.getHighEntropyValues(['model']);
        model = hints.model || model;
      } catch {
        // Client hints unavailable; keep the UA model.
      }
    }
    return { platform: 'android', model };
  }
  return { platform: 'desktop', model: '' };
}

/** Focal length (px) at the 480 x 640 portrait reference for a detected device. */
export function referenceFocal(device) {
  if (!device) return DEFAULT_FOCAL_480x640;
  if (device.platform === 'ios') return IOS_FOCALS[device.model] || DEFAULT_FOCAL_480x640;
  if (device.platform === 'android' && device.model) {
    const hit = ANDROID_FOCALS.find(([prefix]) => device.model.startsWith(prefix));
    if (hit) return hit[1];
  }
  if (device.platform === 'desktop') {
    // Typical webcams have ~60° horizontal FOV on a 4:3 landscape sensor.
    return (0.5 * REF_H) / Math.tan((60 * Math.PI) / 360);
  }
  return DEFAULT_FOCAL_480x640;
}

/**
 * Intrinsics for a capture of captureW x captureH pixels. The calibration is a
 * portrait 480x640 full-sensor model; landscape captures use it transposed.
 */
export function captureIntrinsics(captureW, captureH, focal480 = DEFAULT_FOCAL_480x640) {
  let ref = Intrinsics.fromFocal(REF_W, REF_H, focal480);
  if (captureW > captureH) ref = ref.transposed();
  return ref.cropAndScale(captureW, captureH);
}
