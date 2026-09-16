import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NetworkCard } from './NetworkCard'

describe('NetworkCard', () => {
  it('shows the grill URL, interfaces, WiFi signal and a QR code', () => {
    render(<NetworkCard net={{ hostname: 'pifire', interfaces: [{ name: 'wlan0', ip: '192.168.1.42', up: true }], wifi: { interface: 'wlan0', quality_percent: 70, signal_dbm: -50 } }} />)
    expect(screen.getByText('http://192.168.1.42/')).toBeInTheDocument()
    expect(screen.getByText('pifire')).toBeInTheDocument()
    expect(screen.getByText('70% · -50 dBm')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'QR code for http://192.168.1.42/' })).toBeInTheDocument()
  })
})
