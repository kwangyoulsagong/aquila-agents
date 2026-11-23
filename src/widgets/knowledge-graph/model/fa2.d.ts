// The one ForceAtlas2 step the layout worker needs (the package ships no types for its internal files).
declare module 'graphology-layout-forceatlas2/iterate.js' {
  export interface Fa2Options {
    linLogMode: boolean;
    outboundAttractionDistribution: boolean;
    adjustSizes: boolean;
    edgeWeightInfluence: number;
    scalingRatio: number;
    strongGravityMode: boolean;
    gravity: number;
    slowDown: number;
    barnesHutOptimize: boolean;
    barnesHutTheta: number;
  }
  /** One iteration over the packed matrices (10 floats per node, 3 per edge), in place. */
  export default function iterate(options: Fa2Options, nodes: Float32Array, edges: Float32Array): object;
}
