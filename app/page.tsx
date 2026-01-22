"use client"

import { useState, useMemo, ChangeEvent, useEffect } from 'react'
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
  // Selected columns for each component (up to 4 entries). Use empty string for unselected entries
  const [componentCols, setComponentCols] = useState<string[]>(['', '', '', ''])
  // Selected columns that participate in the mass-balance component pool
  const [componentPool, setComponentPool] = useState<string[]>([])
  // Selected performance/response column
  const [performanceCol, setPerformanceCol] = useState('')
  // Selected Plotly color scale
  const [colorScale, setColorScale] = useState('Viridis')
  // Optional user-specified color scale min and max values. If blank string, min/max will be auto-calculated
  const [cmin, setCmin] = useState<string>('')
  const [cmax, setCmax] = useState<string>('')
  // Sort order for plot rendering (high performance on top or low performance on top)
  const [sortOrder, setSortOrder] = useState<'high' | 'low'>('high')
  // Fixed-value filters for slider component columns
  const [sliderColumns, setSliderColumns] = useState<string[]>([])
  const [sliderValues, setSliderValues] = useState<Record<string, number>>({})

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
        setComponentPool([])
        setSliderColumns([])
        setSliderValues({})
        setPerformanceCol('')
      },
    })
  }

  /**
   * Updates which column is selected for a given component index.
   * Passing an empty string deselects that component.
   */
  const updateComponentCol = (index: number, value: string) => {
    setComponentCols((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  useEffect(() => {
    setComponentCols((prev) =>
      prev.map((col) => (componentPool.includes(col) ? col : '')),
    )
    setSliderColumns((prev) =>
      prev.filter((col) => componentPool.includes(col)),
    )
  }, [componentPool])

  useEffect(() => {
    if (!performanceCol) return
    setComponentPool((prev) => prev.filter((col) => col !== performanceCol))
    setSliderColumns((prev) => prev.filter((col) => col !== performanceCol))
  }, [performanceCol])

  const componentColumns = useMemo(() => {
    return componentPool
  }, [componentPool])

  const extraColumns = useMemo(() => {
    const selected = new Set(componentCols.filter(Boolean))
    return componentColumns.filter((col) => !selected.has(col))
  }, [componentColumns, componentCols])

  const columnStats = useMemo(() => {
    const stats: Record<string, { min: number; max: number }> = {}
    componentColumns.forEach((col) => {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      data.forEach((row) => {
        const total = componentColumns.reduce((sum, componentCol) => {
          const value = row[componentCol]
          const num = typeof value === 'number' ? value : parseFloat(value)
          return isFinite(num) ? sum + num : sum
        }, 0)
        if (total <= 0) return
        const value = row[col]
        const num = typeof value === 'number' ? value : parseFloat(value)
        if (!isFinite(num)) return
        const normalized = num / total
        min = Math.min(min, normalized)
        max = Math.max(max, normalized)
      })
      if (min !== Number.POSITIVE_INFINITY && max !== Number.NEGATIVE_INFINITY) {
        stats[col] = { min, max }
      }
    })
    return stats
  }, [componentColumns, data])

  useEffect(() => {
    setSliderValues((prev) => {
      const next: Record<string, number> = {}
      sliderColumns.forEach((col) => {
        const stats = columnStats[col]
        if (!stats) return
        const existing = prev[col]
        next[col] = existing ?? (stats.min + stats.max) / 2
      })
      return next
    })
  }, [sliderColumns, columnStats])

  const handleComponentPoolChange = (column: string, checked: boolean) => {
    setComponentPool((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, column]))
        : prev.filter((item) => item !== column)
      return next
    })
  }

  const handleSliderColumnChange = (column: string, checked: boolean) => {
    setSliderColumns((prev) => {
      const next = checked
        ? Array.from(new Set([...prev, column]))
        : prev.filter((item) => item !== column)
      return next
    })
  }

  /**
   * Compute the plot data and layout based on the live configuration.
   */
  const { plotData, plotLayout } = useMemo(() => {
    const selectedCompCols = componentCols.filter((c) => c)
    if (
      data.length === 0 ||
      selectedCompCols.length !== 4 ||
      !performanceCol ||
      componentColumns.length === 0
    ) {
      return { plotData: null, plotLayout: null }
    }
    // Extract performance values and compute overall min and max for colour scaling
    const perfValues: number[] = []
    // Data arrays for Plotly
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

    const points: {
      perf: number
      x: number
      y: number
      z: number
      hover: string
    }[] = []

    const tolerance = 0.005
    data.forEach((row) => {
      const total = componentColumns.reduce((sum, componentCol) => {
        const value = row[componentCol]
        const num = typeof value === 'number' ? value : parseFloat(value)
        return isFinite(num) ? sum + num : sum
      }, 0)
      if (total <= 0) {
        return
      }
      for (const sliderCol of sliderColumns) {
        const value = row[sliderCol]
        const num = typeof value === 'number' ? value : parseFloat(value)
        if (!isFinite(num)) {
          return
        }
        const normalized = num / total
        const target = sliderValues[sliderCol]
        if (target === undefined) {
          return
        }
        if (Math.abs(normalized - target) > tolerance) {
          return
        }
      }
      // Extract raw component values
      const comps: number[] = []
      for (let i = 0; i < 4; i++) {
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
      const normalized = comps.map((v) => v / total)
      // Compose hover text with component proportions and performance
      const componentsText = normalized
        .map((v, idx) => `${selectedCompCols[idx]}: ${(v * 100).toFixed(2)}%`)
        .join('<br>')
      const hoverText = `${componentsText}<br>${performanceCol}: ${perf.toFixed(3)}`
      // Convert to 3D Cartesian coordinates for tetrahedral plot
      const [a, b, c, d] = normalized as [number, number, number, number]
      // Weighted sum of vertices
      const x = v0[0] * a + v1[0] * b + v2[0] * c + v3[0] * d
      const y = v0[1] * a + v1[1] * b + v2[1] * c + v3[1] * d
      const z = v0[2] * a + v1[2] * b + v2[2] * c + v3[2] * d
      points.push({ perf, x, y, z, hover: hoverText })
    })

    points.sort((left, right) =>
      sortOrder === 'high'
        ? left.perf - right.perf
        : right.perf - left.perf,
    )
    points.forEach((point) => {
      xVals.push(point.x)
      yVals.push(point.y)
      zVals.push(point.z)
      hoverTexts.push(point.hover)
      perfValues.push(point.perf)
    })
    // Determine colour scale min and max. Use user-provided values if present, otherwise derive from data.
    const perfMin = perfValues.length > 0 ? Math.min(...perfValues) : 0
    const perfMax = perfValues.length > 0 ? Math.max(...perfValues) : 1
    const cminNum = cmin !== '' ? parseFloat(cmin) : perfMin
    const cmaxNum = cmax !== '' ? parseFloat(cmax) : perfMax
    // Build Plotly trace and layout
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
    return { plotData: [meshTrace, scatterTrace], plotLayout: layout }
  }, [
    cmax,
    cmin,
    colorScale,
    componentCols,
    componentColumns,
    data,
    performanceCol,
    sliderColumns,
    sliderValues,
    sortOrder,
  ])

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
        {data.length > 0 && (
          <p className="text-sm text-gray-600">{data.length} data points loaded</p>
        )}
      </div>
      {columns.length > 0 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium">Component columns</label>
            <p className="text-xs text-gray-600">
              Select all columns that contribute to the mass-balance total.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {columns
                .filter((col) => col !== performanceCol)
                .map((col) => (
                  <label key={col} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={componentPool.includes(col)}
                      onChange={(e) =>
                        handleComponentPoolChange(col, e.target.checked)
                      }
                    />
                    {col}
                  </label>
                ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: 4 }).map((_, idx) => (
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
                  {componentColumns.map((col) => (
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
              <label className="block text-sm font-medium">Draw order</label>
              <select
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(e.target.value === 'high' ? 'high' : 'low')
                }
                className="border p-2 rounded"
              >
                <option value="high">High performance on top</option>
                <option value="low">Low performance on top</option>
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
            <label className="block text-sm font-medium">Slider components</label>
            <p className="text-xs text-gray-600">
              Choose which remaining components should be controlled with sliders.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              {extraColumns.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sliderColumns.includes(col)}
                    onChange={(e) =>
                      handleSliderColumnChange(col, e.target.checked)
                    }
                  />
                  {col}
                </label>
              ))}
            </div>
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
      {plotData && plotLayout && sliderColumns.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold">Slider components</h2>
          {sliderColumns.map((col) => {
            const stats = columnStats[col]
            const value = sliderValues[col]
            if (!stats || value === undefined) return null
            return (
              <div key={col} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{col}</span>
                  <span className="text-xs text-gray-600">
                    {value.toFixed(3)}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    type="range"
                    min={stats.min}
                    max={stats.max}
                    step={0.001}
                    value={value}
                    onChange={(e) => {
                      const nextValue = parseFloat(e.target.value)
                      setSliderValues((prev) => ({
                        ...prev,
                        [col]: nextValue,
                      }))
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
