"use client"

import { useState, useMemo, ChangeEvent } from 'react'
import dynamic from 'next/dynamic'
import Papa from 'papaparse'

// Dynamically import Plotly component to avoid SSR issues
// When using dynamic import with a CommonJS module we need to access the default export.
const Plot = dynamic(() => import('react-plotly.js').then((mod) => mod.default), { ssr: false })

interface DataRow {
  [key: string]: any
}

export default function HomePage() {
  // Raw parsed CSV data as an array of objects keyed by column names
  const [data, setData] = useState<DataRow[]>([])
  // List of column names present in the CSV
  const [columns, setColumns] = useState<string[]>([])
  // Number of components (3 for ternary, 4 for tetrahedral, 5+ for N-1D)
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
  // Snapshot of parameters used to generate the current plot (set when clicking "Create plot")
  const [plotParams, setPlotParams] = useState<{
    dimension: number
    componentCols: string[]
    performanceCol: string
    colorScale: string
    cmin: string
    cmax: string
  } | null>(null)

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
        setComponentCols(Array.from({ length: cols.length }, () => ''))
        setPerformanceCol('')
        setPlotParams(null)
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
   * Compute the plot data and layout based on current selections. This useMemo
   * ensures computations only run when relevant dependencies change. Handles
   * both ternary (3-component), tetrahedral (4-component), and N-1D visualisations.
   */
  const { plotData, plotLayout } = useMemo(() => {
    if (!plotParams) {
      return { plotData: null, plotLayout: null }
    }
    const {
      dimension: plotDimension,
      componentCols: plotComponentCols,
      performanceCol: plotPerformanceCol,
      colorScale: plotColorScale,
      cmin: plotCmin,
      cmax: plotCmax,
    } = plotParams
    // Validate that data is available, dimension matches available selections,
    // and required columns are selected
    const selectedCompCols = plotComponentCols
      .slice(0, plotDimension)
      .filter((c) => c)
    if (data.length === 0 || selectedCompCols.length !== plotDimension || !plotPerformanceCol) {
      return { plotData: null, plotLayout: null }
    }
    // Extract performance values and compute overall min and max for colour scaling
    const perfValues: number[] = []
    // Data arrays for Plotly
    const aVals: number[] = []
    const bVals: number[] = []
    const cVals: number[] = []
    const xVals: number[] = []
    const yVals: number[] = []
    const zVals: number[] = []
    const hoverTexts: string[] = []

    // Define tetrahedron vertices for barycentric coordinate conversion
    // These points form an approximately regular tetrahedron
    const v0 = [0, 0, 0]
    const v1 = [1, 0, 0]
    const v2 = [0.5, Math.sqrt(3) / 2, 0]
    const v3 = [0.5, Math.sqrt(3) / 6, Math.sqrt(6) / 3]

    data.forEach((row) => {
      // Extract raw component values
      const comps: number[] = []
      for (let i = 0; i < plotDimension; i++) {
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
      let perf: any = row[plotPerformanceCol]
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
        `${componentsText}<br>${plotPerformanceCol}: ${perf.toFixed(3)}`,
      )
      if (plotDimension === 3) {
        // For ternary plots, assign a,b,c arrays
        aVals.push(normalized[0])
        bVals.push(normalized[1])
        cVals.push(normalized[2])
      } else if (plotDimension === 4) {
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
      }
    })
    // Determine colour scale min and max. Use user-provided values if present, otherwise derive from data.
    const perfMin = perfValues.length > 0 ? Math.min(...perfValues) : 0
    const perfMax = perfValues.length > 0 ? Math.max(...perfValues) : 1
    const cminNum = plotCmin !== '' ? parseFloat(plotCmin) : perfMin
    const cmaxNum = plotCmax !== '' ? parseFloat(plotCmax) : perfMax
    // Build Plotly trace and layout
    if (plotDimension === 3) {
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
          colorscale: plotColorScale,
          cmin: cminNum,
          cmax: cmaxNum,
          size: 6,
          showscale: true,
          colorbar: {
            title: plotPerformanceCol,
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
      return { plotData: [trace], plotLayout: layout }
    }
    if (plotDimension === 4) {
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
          colorscale: plotColorScale,
          cmin: cminNum,
          cmax: cmaxNum,
          size: 4,
          opacity: 0.8,
          showscale: true,
          colorbar: {
            title: plotPerformanceCol,
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
      return { plotData: [meshTrace, scatterTrace], plotLayout: layout }
    }

    const axisValues = Array.from({ length: plotDimension - 1 }, () => [] as number[])
    data.forEach((row) => {
      const comps: number[] = []
      for (let i = 0; i < plotDimension; i++) {
        const col = selectedCompCols[i]
        let val = row[col]
        if (typeof val === 'string') {
          const num = parseFloat(val)
          val = isFinite(num) ? num : NaN
        }
        comps.push(typeof val === 'number' && isFinite(val) ? val : NaN)
      }
      let perf: any = row[plotPerformanceCol]
      if (typeof perf === 'string') {
        const num = parseFloat(perf)
        perf = isFinite(num) ? num : NaN
      }
      if (comps.some((v) => !isFinite(v)) || !isFinite(perf)) {
        return
      }
      const sum = comps.reduce((acc, cur) => acc + cur, 0)
      if (sum <= 0) {
        return
      }
      const normalized = comps.map((v) => v / sum)
      for (let i = 0; i < plotDimension - 1; i++) {
        axisValues[i].push(normalized[i])
      }
    })

    const dimensions = selectedCompCols.slice(0, plotDimension - 1).map((label, idx) => ({
      label,
      values: axisValues[idx],
      range: [0, 1],
    }))

    const trace: any = {
      type: 'parcoords',
      dimensions,
      line: {
        color: perfValues,
        colorscale: plotColorScale,
        cmin: cminNum,
        cmax: cmaxNum,
        showscale: true,
        colorbar: {
          title: plotPerformanceCol,
        },
      },
    }
    const layout: any = {
      margin: { l: 40, r: 40, b: 20, t: 40 },
      height: 600,
      title: `${selectedCompCols.join(' / ')} Simplex (${plotDimension - 1}D)`,
    }
    return { plotData: [trace], plotLayout: layout }
  }, [data, plotParams])

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
  const maxComponents = Math.max(3, columns.length)
  const canPlot =
    data.length > 0 &&
    componentCols.slice(0, dimension).filter(Boolean).length === dimension &&
    Boolean(performanceCol)

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
        {data.length > 0 && (
          <p className="text-sm text-gray-600">
            Imported data points: {data.length}
          </p>
        )}
      </div>
      {columns.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-sm font-medium">Number of components</label>
              <select
                value={dimension}
                onChange={(e) => setDimension(parseInt(e.target.value))}
                className="border p-2 rounded"
              >
                {Array.from({ length: maxComponents - 2 }, (_, idx) => {
                  const value = idx + 3
                  const label =
                    value === 3
                      ? '3 (triangle)'
                      : value === 4
                        ? '4 (tetrahedron)'
                        : `${value}`
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  )
                })}
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
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() =>
                setPlotParams({
                  dimension,
                  componentCols,
                  performanceCol,
                  colorScale,
                  cmin,
                  cmax,
                })
              }
              disabled={!canPlot}
              className="rounded bg-blue-600 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              Create plot
            </button>
            {dimension > 4 && (
              <p className="text-sm text-gray-600">
                Showing the first {dimension - 1} dimensions (N-1) of the simplex.
              </p>
            )}
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
