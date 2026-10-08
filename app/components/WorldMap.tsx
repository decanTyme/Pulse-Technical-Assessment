"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import "mapbox-gl/dist/mapbox-gl.css"
import type { Map as MapboxMap, Marker } from "mapbox-gl"
import type { MapLocation, PeerDot } from "@/lib/types"

interface WorldMapProps {
  children?: ReactNode
  peers: PeerDot[]
  me: MapLocation | null
  onPeerClick: (id: string) => void
  interactive: boolean
  canConnect: boolean
}

type MapStatus = "loading" | "ready" | "error"

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""

function getMapStyle() {
  const dark = document.documentElement.dataset.theme === "dark"
  return `mapbox://styles/mapbox/${dark ? "dark" : "light"}-v11`
}

function applyMapTheme(map: MapboxMap) {
  const colors = getComputedStyle(document.documentElement)
  const readColor = (name: string) => colors.getPropertyValue(name).trim()

  map.setFog({
    color: readColor("--map-atmosphere"),
    "high-color": readColor("--map-water"),
    "space-color": readColor("--background"),
    "horizon-blend": 0.08,
    "star-intensity": 0,
  })
  if (map.getLayer("background")) {
    map.setPaintProperty(
      "background",
      "background-color",
      readColor("--map-land"),
    )
  }
  if (map.getLayer("water")) {
    map.setPaintProperty("water", "fill-color", readColor("--map-water"))
  }
}

export default function WorldMap({
  children,
  peers,
  me,
  onPeerClick,
  interactive,
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
        map.addControl(
          new mapboxgl.NavigationControl({ showCompass: false }),
          "bottom-right",
        )
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
        element.className = "pulse-me"
        element.title = "You are here"
        element.setAttribute("aria-label", "Your approximate location")
        element.innerHTML =
          '<span class="pulse-me-core"></span><span class="pulse-me-label">You</span>'
        meMarkerRef.current = new mapboxgl.Marker({ element })
          .setLngLat([me.lng, me.lat])
          .addTo(map)
        map.easeTo({ center: [me.lng, me.lat], zoom: 2.6, duration: 600 })
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [me, ready])

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
          element.className = "pulse-dot"
          element.setAttribute("role", "button")
          element.innerHTML = '<span class="pulse-dot-core"></span>'
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
    <div className="pulse-world" data-entry={!interactive}>
      <div
        ref={containerRef}
        inert={!interactive}
        className="pulse-map-canvas h-full w-full"
      />

      {children}

      {status === "loading" && (
        <p role="status" className="pulse-map-feedback type-status">
          Loading the globe…
        </p>
      )}

      {status === "error" && (
        <div role="alert" className="pulse-map-feedback">
          <p className="type-status">{"The map couldn't load."}</p>
          <p className="mt-1 text-sm text-muted">
            Check your connection and try again.
          </p>
          {TOKEN && (
            <button
              onClick={reloadMap}
              className="pulse-button pulse-button-secondary mt-3"
            >
              Reload map
            </button>
          )}
        </div>
      )}
    </div>
  )
}
