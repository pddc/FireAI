#!/usr/bin/env python3

'''
*****************************************
 FireAI Simulator Grill Platform
*****************************************

 Description: Drives the in-process thermal model in core.sim instead of GPIO
 pins. Used by the test-suite and the local development harness. Has no
 hardware dependencies (unlike the prototype platform, which imports gpiozero).

*****************************************
'''

import time

from common import create_logger
from core.sim import get_world


class GrillPlatform:

	def __init__(self, config):
		self.logger = create_logger('control')
		self.world = get_world()
		self.out_pins = dict(config.get('outputs', {}) or {})
		self.in_pins = dict(config.get('inputs', {}) or {})
		self.dc_fan = config.get('dc_fan', False)
		self.frequency = config.get('frequency', 100)
		self.standalone = config.get('standalone', True)
		self.current = {}

		self.out_pins['pwm'] = 100 if self.dc_fan else None
		self.out_pins['auger'] = False
		self.out_pins['fan'] = False
		self.out_pins['igniter'] = False
		self.out_pins['power'] = False
		self.in_pins['selector'] = True
		self._ramp_end = 0
		self._ramp_target = 100
		self._sync()

	def _sync(self):
		for name in ('power', 'fan', 'auger', 'igniter'):
			self.world.set_output(name, self.out_pins[name])
		if self.dc_fan:
			self.world.set_output('pwm', self.out_pins['pwm'])

	# ----- outputs ---------------------------------------------------------
	def auger_on(self):
		self.out_pins['auger'] = True
		self.world.set_output('auger', True)

	def auger_off(self):
		self.out_pins['auger'] = False
		self.world.set_output('auger', False)

	def fan_on(self, duty_cycle=100):
		self.out_pins['fan'] = True
		self.world.set_output('fan', True)
		if self.dc_fan:
			self.set_duty_cycle(duty_cycle)

	def fan_off(self):
		self.out_pins['fan'] = False
		self.world.set_output('fan', False)

	def fan_toggle(self):
		if self.out_pins['fan']:
			self.fan_off()
		else:
			self.fan_on()

	def set_duty_cycle(self, percent):
		self._ramp_end = 0
		self.out_pins['pwm'] = float(percent)
		self.world.set_output('pwm', float(percent))

	def pwm_fan_ramp(self, on_time=5, min_duty_cycle=20, max_duty_cycle=100):
		''' Ramp is modelled as an immediate jump to the minimum with a timed target;
		    get_output_status reports the target once the ramp window has elapsed. '''
		self.out_pins['fan'] = True
		self.world.set_output('fan', True)
		self.out_pins['pwm'] = float(min_duty_cycle)
		self._ramp_target = float(max_duty_cycle)
		self._ramp_end = time.time() + on_time
		self.world.set_output('pwm', float(min_duty_cycle))

	def set_pwm_frequency(self, frequency=100):
		self.frequency = frequency

	def igniter_on(self):
		self.out_pins['igniter'] = True
		self.world.set_output('igniter', True)

	def igniter_off(self):
		self.out_pins['igniter'] = False
		self.world.set_output('igniter', False)

	def power_on(self):
		self.out_pins['power'] = True
		self.world.set_output('power', True)

	def power_off(self):
		self.out_pins['power'] = False
		self.world.set_output('power', False)

	# ----- inputs ----------------------------------------------------------
	def get_input_status(self):
		return self.in_pins['selector']

	def set_input_status(self, value):
		self.in_pins['selector'] = value

	def get_output_status(self):
		if self.dc_fan and self._ramp_end and time.time() >= self._ramp_end:
			self._ramp_end = 0
			self.out_pins['pwm'] = self._ramp_target
			self.world.set_output('pwm', self._ramp_target)
		self.current = {
			'auger': self.out_pins['auger'],
			'igniter': self.out_pins['igniter'],
			'power': self.out_pins['power'],
			'fan': self.out_pins['fan'],
		}
		if self.dc_fan:
			self.current['pwm'] = self.out_pins['pwm']
			self.current['frequency'] = self.frequency
		return self.current

	def cleanup(self):
		self.power_off()
		self.igniter_off()
		self.auger_off()
		self.fan_off()

	# ----- system commands -------------------------------------------------
	def supported_commands(self, arglist):
		return {
			'result': 'OK',
			'message': 'Supported commands listed in "data".',
			'data': {'supported_cmds': ['supported_commands', 'check_alive', 'check_throttled', 'check_cpu_temp',
									   'check_wifi_quality', 'os_info', 'network_info', 'hardware_info', 'sim_state']},
		}

	def check_alive(self, arglist):
		return {'result': 'OK', 'message': 'The control script is running.', 'data': {}}

	def check_throttled(self, arglist):
		return {'result': 'OK', 'message': 'No under-voltage or throttling detected.',
				'data': {'cpu_under_voltage': False, 'cpu_throttled': False}}

	def check_cpu_temp(self, arglist):
		return {'result': 'OK', 'message': 'CPU temperature (simulated).', 'data': {'cpu_temp': '42.0'}}

	def check_wifi_quality(self, arglist):
		return {'result': 'OK', 'message': 'WiFi quality (simulated).',
				'data': {'wifi_quality_value': 70, 'wifi_quality_max': 70, 'wifi_quality_percentage': 100}}

	def os_info(self, arglist):
		return {'result': 'OK', 'message': 'OS info (simulated).', 'data': {'os_info': {'PRETTY_NAME': 'FireAI Simulator'}}}

	def network_info(self, arglist):
		return {'result': 'OK', 'message': 'Network info (simulated).', 'data': {'network_info': {}}}

	def hardware_info(self, arglist):
		return {'result': 'OK', 'message': 'Hardware info (simulated).', 'data': {'hardware_info': {'model': 'simulator'}}}

	def sim_state(self, arglist):
		return {'result': 'OK', 'message': 'Simulator state.', 'data': self.world.snapshot()}
