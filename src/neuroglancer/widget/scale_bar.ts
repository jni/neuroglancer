/**
 * @license
 * Copyright 2016 Google Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Facility for drawing a scale bar to indicate pixel size in physical length
 * units.
 *
 * The physical length with which the scale bar is labeled will be of the form:
 *
 *   significand * 10^exponent
 *
 * Any exponent may be used, but the significand in the range [1, 10] will be
 * equal to one of a
 * discrete set of allowed significand values, in order to ensure that the scale
 * bar is easy to
 * understand.
 */

import {RefCounted} from 'neuroglancer/util/disposable';
import {GL} from 'neuroglancer/webgl/context';
import {setTextureFromCanvas} from 'neuroglancer/webgl/texture';

/**
 * Default set of allowed significand values.  1 is implicitly part of the set.
 */
const DEFAULT_ALLOWED_SIGNIFICANDS = [
  1.5,
  2,
  3,
  5,
  7.5,
  10,
];

export interface LengthUnit {
  unit: string;
  lengthInNanometers: number;
}

export const ALLOWED_UNITS: LengthUnit[] = [
  {unit: 'km', lengthInNanometers: 1e12},
  {unit: 'm', lengthInNanometers: 1e9},
  {unit: 'mm', lengthInNanometers: 1e6},
  {unit: 'µm', lengthInNanometers: 1e3},
  {unit: 'nm', lengthInNanometers: 1},
  {unit: 'pm', lengthInNanometers: 1e-3},
];

export function pickLengthUnit(lengthInNanometers: number) {
  const numAllowedUnits = ALLOWED_UNITS.length;
  let unit = ALLOWED_UNITS[numAllowedUnits - 1];
  for (let i = 0; i < numAllowedUnits; ++i) {
    const allowedUnit = ALLOWED_UNITS[i];
    if (lengthInNanometers >= allowedUnit.lengthInNanometers) {
      unit = allowedUnit;
      break;
    }
  }
  return unit;
}

export class ScaleBarDimensions {
  /**
   * Allowed significand values.  1 is not included, but is always considered
   * part of the set.
   */
  allowedSignificands = DEFAULT_ALLOWED_SIGNIFICANDS;

  /**
   * The target length in pixels.  The closest
   */
  targetLengthInPixels: number = 0;

  /**
   * Pixel size in nanometers.
   */
  nanometersPerPixel: number = 0;

  // The following three fields are computed from the previous three fields.

  /**
   * Length that scale bar should be drawn, in pixels.
   */
  lengthInPixels: number;

  /**
   * Physical length with which to label the scale bar.
   */
  physicalLength: number;
  physicalUnit: string;

  prevNanometersPerPixel: number = 0;
  prevTargetLengthInPixels: number = 0;

  /**
   * Updates physicalLength, physicalUnit, and lengthInPixels to be the optimal
   * values corresponding
   * to targetLengthInPixels and nanometersPerPixel.
   *
   * @returns true if the scale bar has changed, false if it is unchanged.
   */
  update() {
    let {nanometersPerPixel, targetLengthInPixels} = this;
    if (this.prevNanometersPerPixel === nanometersPerPixel &&
        this.prevTargetLengthInPixels === targetLengthInPixels) {
      return false;
    }
    this.prevNanometersPerPixel = nanometersPerPixel;
    this.prevTargetLengthInPixels = targetLengthInPixels;
    const targetNanometers = targetLengthInPixels * nanometersPerPixel;
    const exponent = Math.floor(Math.log(targetNanometers) / Math.LN10);
    const tenToThePowerExponent = Math.pow(10, exponent);
    const targetSignificand = targetNanometers / tenToThePowerExponent;

    // Determine significand value in this.allowedSignificands that is closest
    // to targetSignificand.
    let bestSignificand = 1;
    for (let allowedSignificand of this.allowedSignificands) {
      if (Math.abs(allowedSignificand - targetSignificand) <
          Math.abs(bestSignificand - targetSignificand)) {
        bestSignificand = allowedSignificand;
      } else {
        // If distance did not decrease, then it can only increase from here.
        break;
      }
    }

    const physicalNanometers = bestSignificand * tenToThePowerExponent;
    const unit = pickLengthUnit(physicalNanometers);
    this.lengthInPixels = Math.round(physicalNanometers / nanometersPerPixel);
    this.physicalUnit = unit.unit;
    this.physicalLength = physicalNanometers / unit.lengthInNanometers;
    return true;
  }
}

function makeScaleBarTexture(dimensions: ScaleBarDimensions, gl: GL, texture: WebGLTexture|null) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const textHeight = 15;
  const font = `bold ${textHeight}px sans-serif`;
  ctx.font = font;
  ctx.fillStyle = 'white';
  const text = `${dimensions.physicalLength} ${dimensions.physicalUnit}`;
  const textMetrics = ctx.measureText(text);
  const innerWidth = Math.max(dimensions.lengthInPixels, textMetrics.width);
  const barHeight = 8;
  const barTopMargin = 5;
  const innerHeight = barHeight + barTopMargin + textHeight;
  const padding = 2;
  const totalHeight = innerHeight + 2 * padding;
  const totalWidth = innerWidth + 2 * padding;
  canvas.width = totalWidth;
  canvas.height = totalHeight;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(0, 0, totalWidth, totalHeight);
  ctx.fillStyle = 'white';
  ctx.fillText(text, totalWidth / 2, totalHeight - padding - barHeight - barTopMargin);
  ctx.fillRect(padding, totalHeight - padding - barHeight, dimensions.lengthInPixels, barHeight);
  setTextureFromCanvas(gl, texture, canvas);
  return {width: totalWidth, height: totalHeight};
}

export class ScaleBarTexture extends RefCounted {
  texture: WebGLTexture|null = null;
  width = 0;
  height = 0;
  constructor(public gl: GL, public dimensions = new ScaleBarDimensions()) {
    super();
  }

  update() {
    let {dimensions} = this;
    let {texture} = this;
    if (!dimensions.update() && texture !== null) {
      return;
    }
    if (texture === null) {
      texture = this.texture = this.gl.createTexture();
    }
    const {width, height} = makeScaleBarTexture(dimensions, this.gl, texture);
    this.width = width;
    this.height = height;
  }

  disposed() {
    this.gl.deleteTexture(this.texture);
    this.texture = null;
    super.disposed();
  }
}
