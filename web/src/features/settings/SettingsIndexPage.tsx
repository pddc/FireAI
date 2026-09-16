import { Link } from 'react-router-dom'
import { ChevronRight, Cloud, Cpu, Bell, Gauge, Shield, Thermometer, Wrench } from 'lucide-react'
import { IS_CLOUD } from '@/lib/mode'

const SECTIONS = [
  { to: 'cloud', label: 'Cloud', desc: 'Pairing, remote control, monitoring', icon: Cloud, localOnly: true },
  { to: 'general', label: 'General', desc: 'Name, units, theme, dashboard', icon: Wrench },
  { to: 'control', label: 'Control', desc: 'Startup, smoke, hold, shutdown, PID', icon: Gauge },
  { to: 'pellets', label: 'Pellet level', desc: 'Hopper sensor, low-pellet warnings', icon: Thermometer },
  { to: 'probes', label: 'Probes', desc: 'Devices, profiles, tuning', icon: Thermometer },
  { to: 'notifications', label: 'Notifications', desc: 'Pushover, Apprise, MQTT, WLED…', icon: Bell },
  { to: 'safety', label: 'Safety', desc: 'Limits, re-ignite, manual overrides', icon: Shield },
  { to: 'system', label: 'System', desc: 'Hardware, updates, backup, restart', icon: Cpu, localOnly: true },
]

export function SettingsIndexPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="overflow-hidden rounded-xl border bg-card">
        {SECTIONS.filter((s) => !(IS_CLOUD && s.localOnly)).map(({ to, label, desc, icon: Icon }, i) => (
          <Link key={to} to={to} className={`flex items-center gap-3 p-4 transition-colors hover:bg-muted ${i > 0 ? 'border-t' : ''}`}>
            <Icon className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="truncate text-xs text-muted-foreground">{desc}</div>
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  )
}
