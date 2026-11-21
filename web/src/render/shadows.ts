// Soft, contact-hardening shadows (PCSS: percentage-closer soft shadows).
//
// Real shadows are sharp where an object touches the ground and grow softer further away,
// because the sun isn't a point. PCSS imitates that per pixel, in two steps:
//   1. Blocker search: look around this pixel in the shadow map for things between it and the
//      sun, and average how far they are from the sun.
//   2. Filter: the farther the receiver is behind its blockers, the wider the penumbra; average
//      that many shadow-map comparisons over a disc of that width.
// Both steps use a Vogel (golden-angle) disc, turned by interleaved gradient noise per pixel,
// so a few samples give a smooth result without visible patterns.
//
// three.js samples shadow maps in one shader chunk. This swaps the "basic" shadow map's
// lookup (one plain depth read) for PCSS; the renderer then uses BasicShadowMap, which keeps
// the map as a plain depth texture that can be read for the blocker search. The light's
// `shadow.radius` becomes the size of the sun: how much the penumbra widens per unit of
// distance between blocker and receiver (in shadow-map UV per unit of normalized depth).

import * as THREE from "three";

/** The shadow lookup's signature. Two functions have it: the VSM one, then the basic one. */
const SIGNATURE = "float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord )";
/** Marks the chunk once it's been changed. */
export const MARKER = "cvSoftShadowsInstalled";

const pcss = (blockerSamples: number, filterSamples: number) => /* glsl */ `#define ${MARKER} // soft, contact-hardening shadows

		float cvGradientNoise( vec2 p ) {
			return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
		}

		vec2 cvVogel( int i, int count, float phi ) {
			float r = sqrt( ( float( i ) + 0.5 ) / float( count ) );
			float theta = float( i ) * 2.399963229728653 + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}

		// true when the shadow map's depth d is between the receiver (at z) and the light.
		bool cvBlocks( float d, float z ) {
			#ifdef USE_REVERSED_DEPTH_BUFFER
				return d > z;
			#else
				return d < z;
			#endif
		}

		// One filtered comparison: the four nearest texels, weighted bilinearly (what the
		// hardware does for PCF shadow maps, done by hand because this map is read as depth).
		float cvLit( sampler2D shadowMap, vec2 size, vec2 uv, float z ) {
			vec2 st = uv * size - 0.5;
			vec2 f = fract( st );
			vec2 base = ( floor( st ) + 0.5 ) / size;
			vec2 texel = 1.0 / size;
			float a = cvBlocks( texture2D( shadowMap, base ).r, z ) ? 0.0 : 1.0;
			float b = cvBlocks( texture2D( shadowMap, base + vec2( texel.x, 0.0 ) ).r, z ) ? 0.0 : 1.0;
			float c = cvBlocks( texture2D( shadowMap, base + vec2( 0.0, texel.y ) ).r, z ) ? 0.0 : 1.0;
			float d = cvBlocks( texture2D( shadowMap, base + texel ).r, z ) ? 0.0 : 1.0;
			return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;

			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif

			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( inFrustum && shadowCoord.z <= 1.0 ) {

				float texel = 1.0 / shadowMapSize.x;
				float z = shadowCoord.z;
				float phi = cvGradientNoise( gl_FragCoord.xy ) * PI2;
				// Search as wide as the widest penumbra we allow.
				float search = clamp( shadowRadius * 0.12, 3.0 * texel, 48.0 * texel );

				// 1. Blocker search (the centre too, so thin posts are never missed).
				float blockers = 0.0;
				float blockerDepth = 0.0;
				float centre = texture2D( shadowMap, shadowCoord.xy ).r;
				if ( cvBlocks( centre, z ) ) {
					blockerDepth += centre;
					blockers += 1.0;
				}
				for ( int i = 0; i < ${blockerSamples}; i ++ ) {
					float d = texture2D( shadowMap, shadowCoord.xy + cvVogel( i, ${blockerSamples}, phi ) * search ).r;
					if ( cvBlocks( d, z ) ) {
						blockerDepth += d;
						blockers += 1.0;
					}
				}

				if ( blockers > 0.0 ) {
					// 2. Penumbra from the distance between receiver and blockers, then the filter.
					blockerDepth /= blockers;
					float penumbra = clamp( abs( z - blockerDepth ) * shadowRadius, 1.25 * texel, search );
					float lit = 0.0;
					for ( int i = 0; i < ${filterSamples}; i ++ ) {
						lit += cvLit( shadowMap, shadowMapSize, shadowCoord.xy + cvVogel( i, ${filterSamples}, phi + 1.7 ) * penumbra, z );
					}
					shadow = lit / float( ${filterSamples} );
				}
			}

			return mix( 1.0, shadow, shadowIntensity );

		}
`;

let installed: string | null = null;

/**
 * Use PCSS for every material compiled from now on. Call before the first render.
 * Throws if this three.js version's shadow chunk doesn't look the way this code expects,
 * rather than quietly drawing wrong shadows.
 */
export function installSoftShadows(filterSamples: number): void {
  if (installed === null) installed = THREE.ShaderChunk.shadowmap_pars_fragment;
  THREE.ShaderChunk.shadowmap_pars_fragment = withSoftShadows(installed, filterSamples);
}

/**
 * The shadow chunk with the basic lookup swapped for PCSS. Finds the basic function by its
 * signature (the second of the two that read a sampler2D) and its braces, and checks it's the
 * one-tap depth comparison it expects. (Comments can't be anchors: three.js's published
 * build strips them.)
 */
export function withSoftShadows(chunk: string, filterSamples: number): string {
  const fail = (why: string) => new Error(`Soft shadows: three.js's shadow shader changed (${why}); update web/src/render/shadows.ts.`);
  const starts: number[] = [];
  for (let i = chunk.indexOf(SIGNATURE); i >= 0; i = chunk.indexOf(SIGNATURE, i + 1)) starts.push(i);
  if (starts.length !== 2) throw fail(`${starts.length} lookups`);
  const start = starts[1]!;
  if (!/#else[^\n]*\s*$/.test(chunk.slice(0, start))) throw fail("no #else before the basic lookup");
  let depth = 0;
  let end = -1;
  for (let i = chunk.indexOf("{", start); i >= 0 && i < chunk.length; i++) {
    if (chunk[i] === "{") depth++;
    else if (chunk[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw fail("unbalanced braces");
  const body = chunk.slice(start, end);
  if (!body.includes("texture2D( shadowMap, shadowCoord.xy ).r") || !body.includes("step(")) throw fail("not a one-tap lookup");
  const blockerSamples = Math.max(8, Math.round(filterSamples * 0.6));
  return chunk.slice(0, start) + pcss(blockerSamples, filterSamples) + chunk.slice(end);
}

/**
 * The light's `shadow.radius` for PCSS: the sun's apparent size (degrees), turned into
 * penumbra width (shadow-map UV) per unit of normalized depth in its shadow camera.
 */
export function sunSizeToRadius(sunDegrees: number, shadowCamera: THREE.OrthographicCamera): number {
  const depthRange = shadowCamera.far - shadowCamera.near;
  const width = shadowCamera.right - shadowCamera.left;
  return (Math.tan((sunDegrees * Math.PI) / 180) * depthRange) / width;
}
