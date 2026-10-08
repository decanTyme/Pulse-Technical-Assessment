"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import "mapbox-gl/dist/mapbox-gl.css"
import type {
  ExpressionSpecification,
  Map as MapboxMap,
  Marker,
} from "mapbox-gl"
import type { MapLocation, PeerDot } from "@/lib/types"

interface WorldMapProps {
  children?: ReactNode
  peers: PeerDot[]
  me: MapLocation | null
  meStatus: string
  onPeerClick: (id: string) => void
  interactive: boolean
  conversationOpen: boolean
  canConnect: boolean
}

type MapStatus = "loading" | "ready" | "error"
type MapPaintProperty = Parameters<MapboxMap["setPaintProperty"]>[1]
type MapPaintValue = Parameters<MapboxMap["setPaintProperty"]>[2]

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""

const GLOBE_DETAIL_LABELS = [
  "road-label-simple",
  "waterway-label",
  "natural-line-label",
  "natural-point-label",
  "water-line-label",
  "water-point-label",
  "poi-label",
  "airport-label",
  "settlement-subdivision-label",
  "settlement-minor-label",
]

function setLayerPaint(
  map: MapboxMap,
  layerId: string,
  property: MapPaintProperty,
  value: MapPaintValue,
) {
  if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value)
}

function getMapStyle() {
  const dark = document.documentElement.dataset.theme === "dark"
  return `mapbox://styles/mapbox/${dark ? "dark" : "light"}-v11`
}

function applyMapTheme(map: MapboxMap) {
  const colors = getComputedStyle(document.documentElement)
  const readColor = (name: string) => colors.getPropertyValue(name).trim()

  map.setFog({
    color: readColor("--map-atmosphere"),
    "high-color":
      readColor("--map-atmosphere-high") || readColor("--background"),
    "space-color": readColor("--background"),
    "horizon-blend": 0.02,
    "star-intensity": 0,
  })

  setLayerPaint(map, "land", "background-color", readColor("--map-land"))
  setLayerPaint(map, "water", "fill-color", readColor("--map-water"))
  setLayerPaint(map, "waterway", "line-color", readColor("--map-waterway"))

  const landuseColors: ExpressionSpecification = [
    "match",
    ["get", "class"],
    ["wood", "grass", "scrub", "park"],
    readColor("--map-land-canopy"),
    ["agriculture", "pitch", "sand"],
    readColor("--map-land-field"),
    ["residential", "airport"],
    readColor("--map-land-built"),
    readColor("--map-land"),
  ]

  setLayerPaint(map, "landuse", "fill-color", landuseColors)
  setLayerPaint(
    map,
    "national-park",
    "fill-color",
    readColor("--map-land-canopy"),
  )

  const countryBoundaryOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.14,
    1.5,
    0.2,
    3,
    0.48,
    6,
    0.78,
  ]

  const regionBoundaryOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.015,
    1.5,
    0.035,
    3,
    0.16,
    6,
    0.48,
  ]

  for (const layerId of [
    "admin-0-boundary-bg",
    "admin-0-boundary",
    "admin-0-boundary-disputed",
  ]) {
    setLayerPaint(map, layerId, "line-color", readColor("--map-boundary"))
    setLayerPaint(map, layerId, "line-opacity", countryBoundaryOpacity)
  }

  for (const layerId of ["admin-1-boundary-bg", "admin-1-boundary"]) {
    setLayerPaint(map, layerId, "line-color", readColor("--map-boundary-soft"))

    setLayerPaint(map, layerId, "line-opacity", regionBoundaryOpacity)
  }

  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue
    const waterLabel = layer.id.startsWith("water")

    setLayerPaint(
      map,
      layer.id,
      "text-color",
      readColor(waterLabel ? "--map-water-label" : "--map-label"),
    )

    setLayerPaint(
      map,
      layer.id,
      "text-halo-color",
      readColor("--map-label-halo"),
    )
  }

  const detailLabelOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    1.5,
    0.05,
    2.5,
    0.3,
    4,
    0.75,
  ]

  for (const layerId of GLOBE_DETAIL_LABELS) {
    setLayerPaint(map, layerId, "text-opacity", detailLabelOpacity)
  }

  const majorSettlementLabelOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.04,
    1.5,
    0.16,
    3,
    0.72,
    5,
    1,
  ]

  setLayerPaint(
    map,
    "settlement-major-label",
    "text-opacity",
    majorSettlementLabelOpacity,
  )

  const stateLabelOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0,
    2,
    0.04,
    3,
    0.4,
    4,
    0.78,
  ]

  setLayerPaint(map, "state-label", "text-opacity", stateLabelOpacity)

  const countryLabelOpacity: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    0.18,
    1.5,
    0.32,
    3,
    0.72,
    5,
    1,
  ]

  setLayerPaint(map, "country-label", "text-opacity", countryLabelOpacity)
}

export default function WorldMap({
  children,
  peers,
  me,
  meStatus,
  onPeerClick,
  interactive,
  conversationOpen,
  canConnect,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapboxMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const meMarkerRef = useRef<Marker | null>(null)
  const [status, setStatus] = useState<MapStatus>(TOKEN ? "loading" : "error")
  const [reloadKey, setReloadKey] = useState(0)
  const ready = status === "ready"

  // Markers retain their handlers while polling and connection state change.
  const onPeerClickRef = useRef(onPeerClick)
  const canConnectRef = useRef(canConnect)
  useEffect(() => {
    onPeerClickRef.current = onPeerClick
    canConnectRef.current = canConnect
  })

  useEffect(() => {
    if (!TOKEN || !containerRef.current) return
    let cancelled = false
    const markers = markersRef.current
    let currentStyle = getMapStyle()
    const updateTheme = () => {
      const nextStyle = getMapStyle()
      if (!mapRef.current || nextStyle === currentStyle) return
      currentStyle = nextStyle
      setStatus("loading")
      mapRef.current.setStyle(nextStyle)
    }
    const themeObserver = new MutationObserver(updateTheme)
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    })
    const resizeObserver = new ResizeObserver(() => mapRef.current?.resize())
    resizeObserver.observe(containerRef.current)

    void (async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default
        if (cancelled || !containerRef.current) return
        mapboxgl.accessToken = TOKEN
        currentStyle = getMapStyle()
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: currentStyle,
          projection: "globe",
          center: [20, 20],
          zoom: window.innerWidth < 640 ? 0.55 : 1.25,
          attributionControl: true,
        })
        mapRef.current = map
        map.on("style.load", () => {
          if (cancelled) return
          applyMapTheme(map)
        })
        map.on("idle", () => {
          if (!cancelled && map.isStyleLoaded()) setStatus("ready")
        })
        map.on("error", () => {
          if (!cancelled) setStatus("error")
        })
      } catch {
        if (!cancelled) setStatus("error")
      }
    })()

    return () => {
      cancelled = true
      themeObserver.disconnect()
      resizeObserver.disconnect()
      markers.forEach((marker) => marker.remove())
      markers.clear()
      meMarkerRef.current?.remove()
      meMarkerRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [reloadKey])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const desktop = window.matchMedia("(min-width: 48rem)")
    const updateConversationPadding = () => {
      const right = conversationOpen && desktop.matches ? 424 : 0
      const current = map.getPadding()
      if (
        current.top === 0 &&
        current.right === right &&
        current.bottom === 0 &&
        current.left === 0
      ) {
        return
      }

      const padding = { top: 0, right, bottom: 0, left: 0 }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        map.jumpTo({ padding })
      } else {
        map.easeTo({ padding, duration: 320 })
      }
    }

    updateConversationPadding()
    desktop.addEventListener("change", updateConversationPadding)
    return () =>
      desktop.removeEventListener("change", updateConversationPadding)
  }, [conversationOpen, ready])

  // Use the server's offset for both the marker and the camera, never raw fixes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !me) return
    let cancelled = false

    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default
      if (cancelled) return
      if (!meMarkerRef.current) {
        const element = document.createElement("div")
        element.className =
          "pointer-events-none relative grid size-11 place-items-center"
        element.title = "You are here"
        element.setAttribute("aria-label", "Your approximate location")
        element.innerHTML = `
          <span class="size-4 rounded-full border-2 border-surface bg-primary
            shadow-[0_0_0_5px_var(--shadow-warm)]"></span>
          <span class="absolute top-[calc(100%-0.5rem)] left-1/2 -translate-x-1/2
            rounded-md bg-primary px-1.5 py-px text-[11px] font-semibold leading-normal
            whitespace-nowrap text-primary-foreground">You</span>
        `
        const statusLabel = document.createElement("span")
        statusLabel.className = "pulse-status pointer-events-none absolute bottom-full left-1/2 mb-1 max-w-48 -translate-x-1/2 truncate rounded-control bg-surface px-2 py-1 text-xs font-medium text-foreground shadow-[0_2px_12px_var(--shadow-warm)]"
        if (meStatus) {
          statusLabel.textContent = meStatus
          statusLabel.title = meStatus
          element.append(statusLabel)
        }
        meMarkerRef.current = new mapboxgl.Marker({ element })
          .setLngLat([me.lng, me.lat])
          .addTo(map)
        map.easeTo({ center: [me.lng, me.lat], zoom: 2.6, duration: 600 })
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat])
        const label = meMarkerRef.current.getElement().querySelector<HTMLElement>(".pulse-status")
        if (label) {
          label.textContent = meStatus
          label.title = meStatus
          if (!meStatus) label.remove()
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [me, meStatus, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    let cancelled = false

    void (async () => {
      const mapboxgl = (await import("mapbox-gl")).default
      if (cancelled) return
      const markers = markersRef.current
      const seen = new Set<string>()

      for (const peer of peers) {
        seen.add(peer.id)
        let marker = markers.get(peer.id)
        if (!marker) {
          const element = document.createElement("button")
          element.type = "button"
          element.className =
            "group/dot grid size-11 cursor-pointer place-items-center border-0 bg-transparent p-0 disabled:cursor-default"
          element.setAttribute("role", "button")
          // Mapbox positions the outer marker; hover only scales this inner dot.
          element.innerHTML = `
            <span class="size-4 rounded-full border-2 border-surface bg-accent-green
              shadow-[0_2px_6px_rgb(0_0_0/18%)] transition-transform duration-150
              motion-reduce:transition-none group-enabled/dot:group-hover/dot:scale-120
              group-disabled/dot:opacity-50 group-data-[busy=true]/dot:border-accent-green
              group-data-[busy=true]/dot:bg-surface-muted"></span>
          `
          const statusLabel = document.createElement("span")
          statusLabel.className = "pulse-status pointer-events-none absolute bottom-full left-1/2 mb-1 max-w-48 -translate-x-1/2 truncate rounded-control bg-surface px-2 py-1 text-xs font-medium text-foreground shadow-[0_2px_12px_var(--shadow-warm)]"
          element.classList.add("relative")
          element.append(statusLabel)
          element.addEventListener("click", (event) => {
            event.stopPropagation()
            if (canConnectRef.current) onPeerClickRef.current(peer.id)
          })
          marker = new mapboxgl.Marker({ element })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map)
          markers.set(peer.id, marker)
        }
        const element = marker.getElement() as HTMLButtonElement
        element.setAttribute("role", "button")
        element.disabled = peer.busy || !canConnect
        element.title = peer.busy ? "In a conversation" : "Tap to connect"
        element.setAttribute("aria-label", element.title)
        element.dataset.busy = String(peer.busy)
        const label = element.querySelector(".pulse-status") as HTMLElement | null
        if (label) {
          label.textContent = peer.status || ""
          label.title = peer.status || ""
          label.hidden = !peer.status
        }
        element.setAttribute("aria-label", peer.status ? `${element.title}. Status: ${peer.status}` : element.title)
        marker.setLngLat([peer.lng, peer.lat])
      }

      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove()
          markers.delete(id)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [peers, ready, canConnect])

  function reloadMap() {
    setStatus("loading")
    setReloadKey((previous) => previous + 1)
  }

  return (
    <div
      className="group/world absolute inset-0 bg-background"
      data-entry={!interactive}
    >
      <div
        ref={containerRef}
        inert={!interactive}
        className="absolute inset-0 size-full bg-background"
      />

      {children}

      {status === "loading" && (
        <p
          role="status"
          className="
            absolute z-15 max-w-[min(280px,calc(100%-3rem))] rounded-panel bg-surface p-4
            shadow-[0_4px_24px_var(--shadow-warm)] group-data-[entry=true]/world:top-24
            group-data-[entry=true]/world:right-6 group-data-[entry=true]/world:bottom-auto
            group-data-[entry=true]/world:left-auto
            bottom-[max(4rem,calc(env(safe-area-inset-bottom)+2.5rem))] left-6 text-sm font-medium
            leading-snug
          "
        >
          Loading the globe…
        </p>
      )}

      {status === "error" && (
        <div
          role="alert"
          className="
            absolute z-15 max-w-[min(280px,calc(100%-3rem))] rounded-panel bg-surface p-4
            shadow-[0_4px_24px_var(--shadow-warm)] group-data-[entry=true]/world:top-24
            group-data-[entry=true]/world:right-6 group-data-[entry=true]/world:bottom-auto
            group-data-[entry=true]/world:left-auto
            bottom-[max(4rem,calc(env(safe-area-inset-bottom)+2.5rem))] left-6
          "
        >
          <p className="text-sm font-medium leading-snug">
            {"The map couldn't load."}
          </p>
          <p className="mt-1 text-sm text-muted">
            Check your connection and try again.
          </p>
          {TOKEN && (
            <button
              onClick={reloadMap}
              className="
                inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border-0
                px-5 py-2.5 text-[15px] font-semibold leading-snug transition-[background-color,box-shadow]
                duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-55
                bg-surface-muted text-foreground mt-3
              "
            >
              Reload map
            </button>
          )}
        </div>
      )}
    </div>
  )
}
