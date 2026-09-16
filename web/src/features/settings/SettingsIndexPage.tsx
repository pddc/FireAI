import { Link } from 'react-router-dom'
import { ChevronRight, Smartphone, Users, Cloud, Cpu, Bell, Gauge, Shield, Thermometer, Wrench, Package, ScrollText, CircuitBoard, SlidersHorizontal, BookOpen } from 'lucide-react'
import { IS_CLOUD } from '@/lib/mode'

const SECTIONS = [
  { to: 'app', label: 'App', desc: 'Theme, install, notifications on this device', icon: Smartphone },
  { to: 'members', label: 'Members', desc: 'Who can see and control this grill', icon: Users, cloudOnly: true },
  { to: 'cloud', label: 'Cloud', desc: 'Pairing, remote control, monitoring', icon: Cloud, localOnly: true },
  { to: 'general', label: 'General', desc: 'Name, units, theme, dashboard', icon: Wrench },
  { to: 'control', label: 'Control', desc: 'Startup, smoke, hold, shutdown, PID', icon: Gauge },
  { to: '../pellets', label: 'Pellets', desc: 'Hopper contents, profiles, load history', icon: Package },
  { to: 'pellets', label: 'Pellet level sensor', desc: 'Calibration, low-pellet warnings', icon: Package },
  { to: 'probes', label: 'Probes', desc: 'Devices, ports, profiles', icon: Thermometer, localOnly: true },
  { to: 'tuner', label: 'Probe tuner', desc: 'Fit coefficients for a new probe', icon: SlidersHorizontal, localOnly: true },
  { to: '../recipes', label: 'Recipes', desc: 'Programs the grill runs on its own', icon: BookOpen, localOnly: true },
  { to: 'notifications', label: 'Notifications', desc: 'Pushover, Apprise, MQTT, WLED…', icon: Bell },
  { to: 'safety', label: 'Safety', desc: 'Limits, re-ignite, manual overrides', icon: Shield },
  { to: 'events', label: 'Events & logs', desc: 'What happened, when', icon: ScrollText },
  { to: 'hardware', label: 'Hardware', desc: 'Board, display, pellet sensor', icon: CircuitBoard, localOnly: true },
  { to: 'system', label: 'System', desc: 'Info, backup, restart, power', icon: Cpu, localOnly: true },
]

export function SettingsIndexPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="overflow-hidden rounded-xl border bg-card">
        {SECTIONS.filter((s) => !(IS_CLOUD && s.localOnly) && !(!IS_CLOUD && s.cloudOnly)).map(({ to, label, desc, icon: Icon }, i) => (
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
