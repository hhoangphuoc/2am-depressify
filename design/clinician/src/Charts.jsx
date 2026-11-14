import React, { useEffect, useId, useRef } from 'react';
import { START, TODAY, baseline, dateLabel, daysBetween, formatValue, signalDefinitions, timelinePhases } from './data.mjs';

function Chart({ rows, valueKey, min = 0, max, unit, visits, baselineValue = null, label, hatch = false }) {
  const canvas = useRef(null);
  const id = useId();
  useEffect(() => {
    const element = canvas.current;
    const draw = () => {
      const width = element.getBoundingClientRect().width;
      if (!width) return;
      const height = 176;
      const ratio = window.devicePixelRatio || 1;
      element.width = width * ratio;
      element.height = height * ratio;
      const ctx = element.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      const left = 43, right = width - 13, top = 15, bottom = 141;
      const x = date => left + daysBetween(START, date) / 42 * (right - left);
      const y = value => bottom - (value - min) / (max - min) * (bottom - top);
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'right';
      for (const value of [min, (max + min) / 2, max]) {
        ctx.strokeStyle = '#E1E6E7';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(left, y(value)); ctx.lineTo(right, y(value)); ctx.stroke();
        ctx.fillStyle = '#59656B'; ctx.fillText(value.toLocaleString('en-GB'), left - 8, y(value) + 4);
      }
      for (const visit of visits.filter(v => v.date >= START && v.date <= TODAY)) {
        ctx.strokeStyle = '#9DA9AE'; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(x(visit.date), top); ctx.lineTo(x(visit.date), bottom); ctx.stroke();
      }
      if (baselineValue !== null) {
        ctx.strokeStyle = '#927955'; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(left, y(baselineValue)); ctx.lineTo(right, y(baselineValue)); ctx.stroke();
      }
      ctx.setLineDash([]);
      // Hatch days with no value so missing data never reads as a dip to zero.
      if (hatch) { const step = (right - left) / 42; ctx.strokeStyle = '#CDD5D8'; ctx.lineWidth = 1; for (const row of rows) { if (Number.isFinite(row[valueKey])) continue; const cx = x(row.date) - step / 2; ctx.save(); ctx.beginPath(); ctx.rect(cx, top, step, bottom - top); ctx.clip(); for (let k = -(bottom - top); k < step; k += 4) { ctx.beginPath(); ctx.moveTo(cx + k, bottom); ctx.lineTo(cx + k + (bottom - top), top); ctx.stroke(); } ctx.restore(); } }
      ctx.lineWidth = 2; ctx.strokeStyle = '#456D80'; ctx.fillStyle = '#456D80';
      let previous = null;
      for (const row of rows) {
        const value = row[valueKey];
        if (!Number.isFinite(value)) { previous = null; continue; }
        if (previous) { ctx.beginPath(); ctx.moveTo(x(previous.date), y(previous[valueKey])); ctx.lineTo(x(row.date), y(value)); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x(row.date), y(value), valueKey === 'mood' || valueKey.startsWith('PHQ') ? 3.5 : 2.1, 0, Math.PI * 2); ctx.fill();
        previous = row;
      }
      ctx.fillStyle = '#59656B';
      [0, 7, 14, 21, 28, 35, 42].forEach((day, index) => {
        if (width < 430 && index % 2 !== 0) return;
        ctx.textAlign = index === 0 ? 'left' : index === 6 ? 'right' : 'center';
        const date = new Date(Date.parse(`${START}T12:00:00Z`) + day * 86400000).toISOString().slice(0, 10);
        ctx.fillText(dateLabel(date), x(date), 163);
      });
    };
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    draw();
    return () => observer.disconnect();
  }, [rows, valueKey, min, max, visits, baselineValue, hatch]);

  return <>
    <canvas ref={canvas} className="trend-canvas" role="img" aria-label={`${label}. ${min} to ${max} ${unit}. 2 October to 13 November 2026. ${hatch ? 'Hatched columns are days with no data.' : 'Gaps are missing days.'} Dashed vertical lines are Visits. Use the data table below for all values.`} aria-describedby={id} />
    <details className="data-disclosure" id={id}>
      <summary>View {label.toLowerCase()} data table</summary>
      <div className="table-scroll"><table><caption>{label} · synthetic · Europe/Helsinki</caption><thead><tr><th scope="col">Date</th><th scope="col">{label} ({unit})</th><th scope="col">Visit</th></tr></thead><tbody>{rows.map(row => <tr key={row.date}><th scope="row">{dateLabel(row.date)}</th><td>{formatValue(row[valueKey])}</td><td>{visits.some(v => v.date === row.date) ? 'Visit' : '—'}</td></tr>)}</tbody></table></div>
    </details>
  </>;
}

export function ProgressTimeline({ patient, onSetTms }) {
  const types = [...new Set(patient.visits.filter(v => v.type !== 'none').map(v => v.type))];
  const phases = timelinePhases(patient.tms, patient.visits).filter(phase => phase.end > START);
  const intervals = [...(patient.tms > START ? [{ start: START, end: patient.tms, label: 'Before TMS end' }] : []), ...phases];
  return <section className="content-section" aria-labelledby="progress-title">
    <div className="section-heading"><div><h2 id="progress-title">{patient.tms ? 'Progress, Phase by Phase' : 'Progress by date'}</h2><p className="muted">2 Oct – 13 Nov 2026 · separate scales, same dates</p></div></div>
    {patient.tms && patient.visits.some(v=>v.date==='2026-11-13') && <p className="small muted">A new Phase began at today’s Visit.</p>}{patient.tms ? <div className="phase-strip">{intervals.map(phase => {
      const length = daysBetween(phase.start < START ? START : phase.start, phase.end);
      const description = `${phase.label}: ${dateLabel(phase.start)} to ${dateLabel(phase.end)}`;
      return <div key={phase.start} style={{ flex: length }} title={description}><span className="phase-line" aria-hidden="true" /><strong aria-hidden="true">{length < 7 ? phase.label.replace('Phase ', '') : phase.label}</strong>{length >= 10 && <span className="phase-dates" aria-hidden="true">{dateLabel(phase.start)} – {dateLabel(phase.end)}</span>}<span className="sr-only">{description}</span></div>;
    })}</div> : <div className="notice"><span>Add the TMS end date to show weeks and Phases.</span><button onClick={onSetTms}>Add TMS end date</button></div>}
    <div className="chart-heading"><h3>Mood rating</h3><span className="muted">Patient reported · 1–5</span></div>
    <Chart rows={patient.daily} valueKey="mood" min={1} max={5} unit="rating" visits={patient.visits} label="Mood rating" />
    {types.length ? types.map(type => {
      const rows = patient.daily.map(row => ({ date: row.date, [type]: patient.visits.find(v => v.date === row.date && v.type === type)?.score ?? null }));
      return <div className="questionnaire-chart" key={type}><div className="chart-heading"><h3>{type}</h3><span className="muted">Recorded at Visits · 0–{type === 'PHQ-2' ? 6 : 27}</span></div><Chart rows={rows} valueKey={type} max={type === 'PHQ-2' ? 6 : 27} unit="score" visits={patient.visits} label={type} /></div>;
    }) : <p className="muted">No Questionnaire scores recorded.</p>}
    <p className="chart-note">Dashed vertical lines mark Visits. Gaps mean no entry. Questionnaire scores never determine the Attention flag.</p>
    <div className="visit-markers"><span>{patient.tms ? `TMS ended ${dateLabel(patient.tms)}` : 'TMS end date not recorded'}</span>{[...patient.visits].sort((a, b) => a.date.localeCompare(b.date)).map(v => <span key={v.id}>Visit {dateLabel(v.date)}{v.type !== 'none' && ` · ${v.type}: ${v.score}`}</span>)}</div>
  </section>;
}

// 14-day sleep sparkline for the Patient list: hatched days have no data, dashed line is the Patient's own Baseline.
export function Sparkline({ rows, valueKey = 'sleep', days = 14 }) {
  const recent = rows.slice(-days), w = 120, h = 32, pad = 3, step = w / days;
  const values = recent.map(r => r[valueKey]).filter(Number.isFinite), own = baseline(rows, valueKey).value;
  const lo = Math.min(...values, own ?? Infinity) - .3, hi = Math.max(...values, own ?? -Infinity) + .3;
  const y = v => h - pad - (v - lo) / (hi - lo) * (h - pad * 2), missing = recent.filter(r => !Number.isFinite(r[valueKey])).length;
  const segments = []; let current = [];
  recent.forEach((r, i) => { if (Number.isFinite(r[valueKey])) current.push([i * step + step / 2, y(r[valueKey])]); else { if (current.length) segments.push(current); current = []; } });
  if (current.length) segments.push(current);
  const last = recent.at(-1)[valueKey];
  return <svg className="sparkline" width={w} height={h} viewBox={'0 0 ' + w + ' ' + h} role="img" aria-label={'Sleep, last ' + days + ' days. Latest ' + (Number.isFinite(last) ? last.toFixed(1) + ' h' : 'no data') + (own !== null ? ', Baseline ' + own.toFixed(1) + ' h' : '') + (missing ? ', ' + missing + ' days without data' : '')}>
    <defs><pattern id="spark-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#CDD5D8" strokeWidth="1.5" /></pattern></defs>
    {recent.map((r, i) => Number.isFinite(r[valueKey]) ? null : <rect key={r.date} x={i * step} y="0" width={step} height={h} fill="url(#spark-hatch)" />)}
    {own !== null && <line x1="0" x2={w} y1={y(own)} y2={y(own)} stroke="#927955" strokeDasharray="3 3" strokeWidth="1" />}
    {segments.map((seg, i) => <polyline key={i} points={seg.map(p => p.join(',')).join(' ')} fill="none" stroke="#456D80" strokeWidth="1.6" strokeLinejoin="round" />)}
    {Number.isFinite(last) && <circle cx={w - step / 2} cy={y(last)} r="2.4" fill="#456D80" />}
  </svg>;
}

export function SignalTrends({ patient, state }) {
  const rows = state === 'unavailable' ? patient.daily.map(row => ({ ...row, ...Object.fromEntries(signalDefinitions.map(s => [s.key, null])) })) : state === 'baseline' ? patient.daily.map((row, index) => index < 39 ? { ...row, ...Object.fromEntries(signalDefinitions.map(s => [s.key, null])) } : row) : patient.daily;
  return <section className="content-section" aria-labelledby="signal-title"><div className="section-heading"><div><h2 id="signal-title">Signals</h2><p className="muted">Compared with this Patient’s own previous 14 days · at least 5 valid days</p></div></div>
    <div className="signal-grid">{signalDefinitions.map(signal => {
      const own = baseline(rows, signal.key);
      const latest = rows.at(-1)[signal.key];
      return <article className="signal" key={signal.key}><div className="chart-heading"><h3>{signal.label}</h3><span>{formatValue(latest, signal.unit)}</span></div><p className="muted small">Synthetic {signal.source.toLowerCase()} · Consent on</p>{patient.id === 'alex' && signal.key === 'hrv' && <p className="small muted">HRV not provided in the phone scenario. No fallback values.</p>}
        {state === 'unavailable' ? <div className="signal-empty">Signal unavailable. No values received.<p className="muted">Missing data is not zero.</p></div> : <Chart rows={rows} valueKey={signal.key} max={signal.max} unit={signal.unit} visits={patient.visits} baselineValue={own.value} label={signal.label} hatch />}
        <p className="baseline-label">{own.value === null ? `Building Baseline · ${own.validDays}/5 valid days` : `Dashed horizontal line: Baseline ${formatValue(own.value, signal.unit)} · ${own.validDays} valid days`}</p>
      </article>;
    })}</div>
  </section>;
}
