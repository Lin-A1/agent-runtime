import type { Tool } from "@newhorse/core"

/** WMO weather-code → 中文描述 (Open-Meteo `weather_code`). */
function codeText(code: number): string {
  if (code === 0) return "晴"
  if (code === 1) return "基本晴"
  if (code === 2) return "多云"
  if (code === 3) return "阴"
  if (code >= 45 && code <= 48) return "雾"
  if (code >= 51 && code <= 57) return "毛毛雨"
  if (code >= 60 && code <= 67) return "雨"
  if (code >= 71 && code <= 77) return "雪"
  if (code === 80 || code === 81 || code === 82) return "阵雨"
  if (code === 85 || code === 86) return "阵雪"
  if (code >= 95) return "雷暴"
  return `天气码 ${code}`
}

/** 常用城市 → 经纬度（够日常用；不在表里也可用 lat/lon 参数）。 */
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  beijing: { lat: 39.9, lon: 116.4 },
  shanghai: { lat: 31.2, lon: 121.5 },
  guangzhou: { lat: 23.1, lon: 113.3 },
  shenzhen: { lat: 22.5, lon: 114.1 },
  hangzhou: { lat: 30.3, lon: 120.2 },
  chengdu: { lat: 30.6, lon: 104.1 },
  wuhan: { lat: 30.6, lon: 114.3 },
  xian: { lat: 34.3, lon: 108.9 },
  chongqing: { lat: 29.6, lon: 106.6 },
  nanjing: { lat: 32.1, lon: 118.8 },
  tianjin: { lat: 39.1, lon: 117.2 },
  suzhou: { lat: 31.3, lon: 120.6 },
  zhuhai: { lat: 22.3, lon: 113.6 },
  xiamen: { lat: 24.5, lon: 118.1 },
  qingdao: { lat: 36.1, lon: 120.4 },
  changsha: { lat: 28.2, lon: 113.0 },
}

export function createWeatherTool(): Tool {
  return {
    name: "weather",
    sideEffects: false,
    description:
      "查询当前天气（Open-Meteo，免费无 Key）。Args: { city? （beijing/shanghai/广州等常用城市，缺省北京）, lat?, lon?（任意坐标）, days?（未来预报天数，默认1）}。返回当前温度/体感/天气描述/湿度+未来预报。",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市（拼音或中文，如 beijing/上海；缺省北京）" },
        lat: { type: "number", description: "纬度（与 lon 一起覆盖 city）" },
        lon: { type: "number", description: "经度" },
        days: { type: "number", description: "未来预报天数 1-7" },
      },
    },
    execute: async (input: unknown): Promise<unknown> => {
      const { city, lat, lon, days } = (input ?? {}) as { city?: string; lat?: number; lon?: number; days?: number }
      let aLat = lat
      let aLon = lon
      if (aLat === undefined || aLon === undefined) {
        const key = (city ?? "beijing").trim().toLowerCase()
        // 中文名（如 "上海"）也查一下常用表
        const cjk = CITY_COORDS[key as string] ?? CITY_COORDS[Object.keys(CITY_COORDS).find((k) => key.includes(k) || k.includes(key)) as string]
        const coord = cjk ?? CITY_COORDS["beijing"]!
        aLat = coord.lat
        aLon = coord.lon
      }
      const n = Math.min(7, Math.max(1, Math.floor(days ?? 1)))
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${aLat}&longitude=${aLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${n}`
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
        if (!res.ok) return { error: `weather api ${res.status}` }
        const d = (await res.json()) as {
          current?: { temperature_2m?: number; relative_humidity_2m?: number; apparent_temperature?: number; weather_code?: number; wind_speed_10m?: number }
          daily?: { weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[] }
        }
        const cur = d.current
        const daily = d.daily
        const out: Record<string, unknown> = {
          city: city ?? (aLat === 39.9 && aLon === 116.4 ? "北京" : `${aLat.toFixed(2)},${aLon.toFixed(2)}`),
          current: cur ? {
            temperature: `${cur.temperature_2m}°C`,
            feelsLike: cur.apparent_temperature !== undefined ? `${cur.apparent_temperature}°C` : undefined,
            condition: cur.weather_code !== undefined ? codeText(cur.weather_code) : undefined,
            humidity: cur.relative_humidity_2m !== undefined ? `${cur.relative_humidity_2m}%` : undefined,
            wind: cur.wind_speed_10m !== undefined ? `${cur.wind_speed_10m} km/h` : undefined,
          } : undefined,
        }
        if (daily?.weather_code?.length && n > 1) {
          out.forecast = daily.weather_code.map((c, i) => ({
            day: `+${i + 1}`,
            condition: codeText(c),
            max: daily.temperature_2m_max?.[i] !== undefined ? `${daily.temperature_2m_max[i]}°C` : undefined,
            min: daily.temperature_2m_min?.[i] !== undefined ? `${daily.temperature_2m_min[i]}°C` : undefined,
          }))
        }
        return out
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    },
  }
}
