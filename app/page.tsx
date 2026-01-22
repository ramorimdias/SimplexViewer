"use client"

import { useState, ChangeEvent } from 'react'
import dynamic from 'next/dynamic'
import type { PlotParams } from 'react-plotly.js'
import Papa from 'papaparse'

// Dynamically import Plotly component to avoid SSR issues
// When using dynamic import with a CommonJS module we need to access the default export.
const Plot = dynamic<PlotParams>(
  () => import('react-plotly.js').then((mod) => mod.default),
  { ssr: false },
)

interface DataRow {
  [key: string]: any
}

export default function HomePage() {
  // Raw parsed CSV data as an array of objects keyed by column names
  const [data, setData] = useState<DataRow[]>([])
  // List of column names present in the CSV
  const [columns, setColumns] = useState<string[]>([])
  // Number of components (N for an (N-1)-simplex)
  const [dimension, setDimension] = useState(3)
  // Selected columns for each component. Use empty string for unselected entries
  const [componentCols, setComponentCols] = useState<string[]>(['', '', '', ''])
  // Selected performance/response column
  const [performanceCol, setPerformanceCol] = useState('')
  // Selected Plotly color scale
  const [colorScale, setColorScale] = useState('Viridis')
  // Optional user-specified color scale min and max values. If blank string, min/max will be auto-calculated
  const [cmin, setCmin] = useState<string>('')
  const [cmax, setCmax] = useState<string>('')
  const [plotData, setPlotData] = useState<PlotParams['data'] | null>(null)
  const [plotLayout, setPlotLayout] = useState<PlotParams['layout'] | null>(null)

  /**
   * Handles file input changes. Parses the selected CSV using PapaParse and updates
   * the data and column names state. Supports header rows and automatic type detection.
   */
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse<DataRow>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData = results.data
        const cols = results.meta.fields ?? []
        setData(parsedData)
        setColumns(cols)
        // Reset selections when a new file is loaded
        setComponentCols(['', '', '', ''])
        setPerformanceCol('')
        setPlotData(null)
        setPlotLayout(null)
      },
    })
  }

  /**
   * Updates which column is selected for a given component index. When users
   * choose the number of components (dimension), the extra fields remain in the
   * array but are unused. Passing an empty string deselects that component.
   */
  const updateComponentCol = (index: number, value: string) => {
    setComponentCols((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  /**
   * Build the plot data and layout based on current selections. Handles
   * ternary (3-component), tetrahedral (4-component), and higher-dimensional
   * simplex projections.
   */
  const buildPlot = () => {
    // Validate that data is available, dimension matches available selections,
    // and required columns are selected
    const selectedCompCols = componentCols.slice(0, dimension).filter((c) => c)
    if (data.length === 0 || selectedCompCols.length !== dimension || !performanceCol) {
      setPlotData(null)
      setPlotLayout(null)
      return
    }
    // Extract performance values and compute overall min and max for colour scaling
    const perfValues: number[] = []
    // Data arrays for Plotly
    const aVals: number[] = []
    const bVals: number[] = []
    const cVals: number[] = []
    const dVals: number[] = []
    const xVals: number[] = []
    const yVals: number[] = []
    const zVals: number[] = []
    const parCoords: number[][] = []
    const hoverTexts: string[] = []

    // Define tetrahedron vertices for barycentric coordinate conversion
    // These points form an approximately regular tetrahedron
    const v0 = [0, 0, 0]
    const v1 = [1, 0, 0]
    const v2 = [0.5, Math.sqrt(3) / 2, 0]
    const v3 = [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3]

    data.forEach((row, rowIndex) => {
      // Extract raw component values
      const comps: number[] = []
      for (let i = 0; i < dimension; i++) {
        const col = selectedCompCols[i]
        let val = row[col]
        // Convert strings to numbers if possible
        if (typeof val === 'string') {
          const num = parseFloat(val)
          val = isFinite(num) ? num : NaN
        }
        comps.push(typeof val === 'number' && isFinite(val) ? val : NaN)
      }
      // Extract performance value
      let perf: any = row[performanceCol]
      if (typeof perf === 'string') {
        const num = parseFloat(perf)
        perf = isFinite(num) ? num : NaN
      }
      // Skip rows with NaNs
      if (comps.some((v) => !isFinite(v)) || !isFinite(perf)) {
        return
      }
      // Compute normalised barycentric coordinates by dividing by the sum
      const sum = comps.reduce((acc, cur) => acc + cur, 0)
      if (sum <= 0) {
        return
      }
      const normalized = comps.map((v) => v / sum)
      // Store performance value
      perfValues.push(perf)
      // Compose hover text with component proportions and performance
      const componentsText = normalized
        .map((v, idx) => `${selectedCompCols[idx]}: ${(v * 100).toFixed(2)}%`)
        .join('<br>')
      hoverTexts.push(
        `${componentsText}<br>${performanceCol}: ${perf.toFixed(3)}`,
      )
      if (dimension === 3) {
        // For ternary plots, assign a,b,c arrays
        aVals.push(normalized[0])
        bVals.push(normalized[1])
        cVals.push(normalized[2])
      } else if (dimension === 4) {
        // Convert to 3D Cartesian coordinates for tetrahedral plot
        const [a, b, c, d] = normalized as [number, number, number, number]
        // Weighted sum of vertices
        const x =
          v0[0] * a + v1[0] * b + v2[0] * c + v3[0] * d
        const y =
          v0[1] * a + v1[1] * b + v2[1] * c + v3[1] * d
        const z =
          v0[2] * a + v1[2] * b + v2[2] * c + v3[2] * d
        xVals.push(x)
        yVals.push(y)
        zVals.push(z)
      } else {
        // For N>4, keep N-1 dimensions (drop the redundant last component)
        parCoords.push(normalized.slice(0, normalized.length - 1))
      }
    })
    // Determine colour scale min and max. Use user-provided values if present, otherwise derive from data.
    const perfMin = perfValues.length > 0 ? Math.min(...perfValues) : 0
    const perfMax = perfValues.length > 0 ? Math.max(...perfValues) : 1
    const cminNum = cmin !== '' ? parseFloat(cmin) : perfMin
    const cmaxNum = cmax !== '' ? parseFloat(cmax) : perfMax
    // Build Plotly trace and layout
    if (dimension === 3) {
      const trace: any = {
        type: 'scatterternary',
        mode: 'markers',
        a: aVals,
        b: bVals,
        c: cVals,
        text: hoverTexts,
        hoverinfo: 'text',
        marker: {
          color: perfValues,
          colorscale: colorScale,
          cmin: cminNum,
          cmax: cmaxNum,
          size: 6,
          showscale: true,
          colorbar: {
            title: performanceCol,
            titleside: 'right',
          },
        },
      }
      const layout: any = {
        ternary: {
          sum: 1,
          aaxis: {
            title: selectedCompCols[0],
            min: 0,
            tickformat: '.2f',
          },
          baxis: {
            title: selectedCompCols[1],
            min: 0,
            tickformat: '.2f',
          },
          caxis: {
            title: selectedCompCols[2],
            min: 0,
            tickformat: '.2f',
          },
        },
        margin: { l: 0, r: 0, b: 0, t: 30 },
        height: 600,
        title: `${selectedCompCols.join(' / ')} Simplex`,
      }
      setPlotData([trace])
      setPlotLayout(layout)
      return
    }
    if (dimension === 4) {
      // Build a mesh to visualise the tetrahedron boundaries
      const tetraX = [v0[0], v1[0], v2[0], v3[0]]
      const tetraY = [v0[1], v1[1], v2[1], v3[1]]
      const tetraZ = [v0[2], v1[2], v2[2], v3[2]]
      // Faces of the tetrahedron defined by vertex indices
      const meshI = [0, 0, 0, 1]
      const meshJ = [1, 1, 2, 2]
      const meshK = [2, 3, 3, 3]
      const meshTrace: any = {
        type: 'mesh3d',
        x: tetraX,
        y: tetraY,
        z: tetraZ,
        i: meshI,
        j: meshJ,
        k: meshK,
        opacity: 0.1,
        color: 'lightgrey',
        flatshading: true,
        hoverinfo: 'skip',
        showscale: false,
      }
      const scatterTrace: any = {
        type: 'scatter3d',
        mode: 'markers',
        x: xVals,
        y: yVals,
        z: zVals,
        text: hoverTexts,
        hoverinfo: 'text',
        marker: {
          color: perfValues,
          colorscale: colorScale,
          cmin: cminNum,
          cmax: cmaxNum,
          size: 4,
          opacity: 0.8,
          showscale: true,
          colorbar: {
            title: performanceCol,
          },
        },
      }
      const layout: any = {
        scene: {
          xaxis: { title: 'X', showgrid: false, zeroline: false },
          yaxis: { title: 'Y', showgrid: false, zeroline: false },
          zaxis: { title: 'Z', showgrid: false, zeroline: false },
          aspectmode: 'data',
        },
        margin: { l: 0, r: 0, b: 0, t: 30 },
        height: 600,
        title: `${selectedCompCols.join(' / ')} Tetrahedron`,
      }
      setPlotData([meshTrace, scatterTrace])
      setPlotLayout(layout)
      return
    }
    const axes = selectedCompCols.slice(0, -1).map((label, idx) => ({
      label,
      range: [0, 1],
      values: parCoords.map((row) => row[idx]),
    }))
    const trace: any = {
      type: 'parcoords',
      line: {
        color: perfValues,
        colorscale: colorScale,
        cmin: cminNum,
        cmax: cmaxNum,
        showscale: true,
        colorbar: { title: performanceCol },
      },
      dimensions: axes,
    }
    const layout: any = {
      margin: { l: 40, r: 40, b: 20, t: 30 },
      height: 600,
      title: `${selectedCompCols.join(' / ')} Simplex (N-1 dimensions)`,
    }
    setPlotData([trace])
    setPlotLayout(layout)
  }

  // List of built-in Plotly colour scales. Users can extend this list as desired.
  const colorScales = [
    'Viridis',
    'Cividis',
    'Plasma',
    'Inferno',
    'Magma',
    'Turbo',
    'Jet',
    'Hot',
    'Earth',
    'Electric',
    'Rainbow',
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Upload CSV File</label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="block border p-2 rounded w-full"
        />
      </div>
      {columns.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            Imported data points: <span className="font-semibold">{data.length}</span>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium">Number of components</label>
              <select
                value={dimension}
                onChange={(e) => {
                  const next = parseInt(e.target.value)
                  setDimension(next)
                  setComponentCols((prev) => {
                    const padded = [...prev]
                    while (padded.length < next) {
                      padded.push('')
                    }
                    return padded
                  })
                }}
                className="border p-2 rounded"
              >
                {Array.from({ length: Math.max(columns.length - 2, 1) }).map(
                  (_, idx) => {
                    const value = idx + 3
                    if (value > columns.length) {
                      return null
                    }
                    return (
                      <option key={value} value={value}>
                        {value} components
                      </option>
                    )
                  },
                )}
              </select>
            </div>
            {Array.from({ length: dimension }).map((_, idx) => (
              <div key={idx}>
                <label className="block text-sm font-medium">
                  Component {idx + 1} column
                </label>
                <select
                  value={componentCols[idx] || ''}
                  onChange={(e) => updateComponentCol(idx, e.target.value)}
                  className="border p-2 rounded"
                >
                  <option value="">Select column</option>
                  {columns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium">Performance column</label>
              <select
                value={performanceCol}
                onChange={(e) => setPerformanceCol(e.target.value)}
                className="border p-2 rounded"
              >
                <option value="">Select column</option>
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium">Colour scale</label>
              <select
                value={colorScale}
                onChange={(e) => setColorScale(e.target.value)}
                className="border p-2 rounded"
              >
                {colorScales.map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Colour min (optional)</label>
              <input
                type="number"
                value={cmin}
                onChange={(e) => setCmin(e.target.value)}
                placeholder="auto"
                className="border p-2 rounded w-32"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Colour max (optional)</label>
              <input
                type="number"
                value={cmax}
                onChange={(e) => setCmax(e.target.value)}
                placeholder="auto"
                className="border p-2 rounded w-32"
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={buildPlot}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Create plot
            </button>
          </div>
        </div>
      )}
      {plotData && plotLayout && (
        <div className="w-full overflow-x-auto">
          <Plot
            data={plotData as any}
            layout={plotLayout as any}
            config={{ responsive: true }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      )}
    </div>
  )
}
