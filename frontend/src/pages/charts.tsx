/** Graphiques SVG maison : aucune librairie externe, aucun appel reseau, rendu deterministe. */

export interface Datum {
  label: string;
  value: number;
  color?: string;
}

const RED = '#E03131';
const RED_DARK = '#A51111';
const GREEN = '#12A150';
const GRAY = '#C2C8D4';

export function BarChart({ data, height = 180, tone = RED, unit = '' }: { data: Datum[]; height?: number; tone?: string; unit?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="py-8 text-center text-sm text-ink-400">Aucune donnée.</p>;

  return (
    <div className="w-full" style={{ height }}>
      <div className="flex h-full items-end gap-2">
        {data.map((d) => {
          const h = Math.round((d.value / max) * 100);
          return (
            <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[11px] font-semibold text-ink-600">
                {d.value}
                {unit}
              </span>
              <div
                className="w-full rounded-t-md transition-all"
                style={{ height: `${Math.max(3, h)}%`, backgroundColor: d.color ?? tone }}
                title={`${d.label}: ${d.value}${unit}`}
              />
              <span className="w-full truncate text-center text-[10px] font-medium uppercase tracking-wide text-ink-400">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Donut({ data, size = 150, centerLabel, centerValue }: { data: Datum[]; size?: number; centerLabel?: string; centerValue?: string }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Répartition">
        <g transform="translate(70 70) rotate(-90)">
          <circle r={radius} fill="none" stroke="#EDEFF3" strokeWidth="16" />
          {total > 0 &&
            data.map((d, i) => {
              const length = (d.value / total) * circumference;
              const dash = `${length} ${circumference - length}`;
              const el = (
                <circle
                  key={d.label}
                  r={radius}
                  fill="none"
                  stroke={d.color ?? [RED, RED_DARK, GREEN, GRAY][i % 4]}
                  strokeWidth="16"
                  strokeDasharray={dash}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                />
              );
              offset += length;
              return el;
            })}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-ink-800" style={{ fontSize: 20, fontWeight: 700 }}>
          {centerValue ?? total}
        </text>
        {centerLabel ? (
          <text x="70" y="84" textAnchor="middle" className="fill-ink-400" style={{ fontSize: 9, letterSpacing: 1 }}>
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2 text-ink-600">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color ?? [RED, RED_DARK, GREEN, GRAY][i % 4] }} />
            <span className="min-w-0 flex-1">{d.label}</span>
            <span className="font-semibold text-ink-800">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: 'hospital' | 'donor' | 'confirmed' | 'coming';
}

/**
 * Carte schematique (pas de fond de plan ni de tuiles externes).
 * Les coordonnees sont projettees lineairement dans un cadre ; c'est volontairement
 * approximatif et aucune coordonnee precise de donneur n'est exposee par l'API.
 */
export function MapSketch({ center, points, height = 260 }: { center: { lat: number; lng: number }; points: MapPoint[]; height?: number }) {
  const all = [{ lat: center.lat, lng: center.lng }, ...points];
  const latMin = Math.min(...all.map((p) => p.lat));
  const latMax = Math.max(...all.map((p) => p.lat));
  const lngMin = Math.min(...all.map((p) => p.lng));
  const lngMax = Math.max(...all.map((p) => p.lng));
  const latSpan = Math.max(0.01, latMax - latMin);
  const lngSpan = Math.max(0.01, lngMax - lngMin);

  const project = (lat: number, lng: number) => ({
    x: 24 + ((lng - lngMin) / lngSpan) * 232,
    y: 24 + ((latMax - lat) / latSpan) * 152,
  });

  const colors: Record<MapPoint['kind'], string> = {
    hospital: '#7A0C0C',
    donor: '#8C95A6',
    coming: '#E8590C',
    confirmed: '#12A150',
  };

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-[#F7F8FA]">
      <svg viewBox="0 0 280 200" width="100%" height={height} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte schématique">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#E4E7EC" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="280" height="200" fill="url(#grid)" />
        <circle cx="140" cy="100" r="78" fill="none" stroke="#FFC9C9" strokeDasharray="3 4" />
        <circle cx="140" cy="100" r="46" fill="none" stroke="#FFE3E3" strokeDasharray="3 4" />

        {points.map((p) => {
          const { x, y } = project(p.lat, p.lng);
          return (
            <g key={p.id}>
              <circle cx={x} cy={y} r={p.kind === 'hospital' ? 7 : 5.5} fill={colors[p.kind]} stroke="#fff" strokeWidth="2">
                <title>{p.label}</title>
              </circle>
              {p.kind === 'hospital' ? <text x={x} y={y - 11} textAnchor="middle" style={{ fontSize: 8, fontWeight: 700, fill: RED_DARK }}>H</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MiniSpark({ values, tone = RED }: { values: number[]; tone?: string }) {
  if (values.length < 2) return <div className="h-8 w-full rounded bg-ink-100" />;
  const max = Math.max(...values, 1);
  const step = 100 / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${28 - (v / max) * 24}`).join(' ');
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-full" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
