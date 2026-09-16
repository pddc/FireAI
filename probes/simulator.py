'''
*****************************************
 FireAI Simulator Probe Device
*****************************************

Description:
  Reports temperatures from the in-process thermal model in core.sim. The
  primary port tracks the pit; food ports track the modelled food probes in
  port order. No voltage/Steinhart-Hart conversion is performed, so any probe
  profile works.

	Ex Device Definition:

	device_info = {
			'device' : 'sim',
			'module' : 'simulator',
			'ports' : ['SIM0', 'SIM1', 'SIM2', 'SIM3'],
			'config' : {}
		}
'''

from core.sim import get_world
from probes.base import ProbeInterface


class SimDevice:
	def __init__(self):
		self.world = get_world()
		self.status = {'connected': True, 'error': None}

	def get_status(self):
		return self.status


class ReadProbes(ProbeInterface):

	def __init__(self, probe_info, device_info, units):
		super().__init__(probe_info, device_info, units)

	def _init_device(self):
		self.time_delay = 0
		self.device = SimDevice()

	def _convert(self, temp_f):
		if self.units == 'C':
			return round((temp_f - 32) * 5 / 9, 1)
		return int(round(temp_f))

	def read_all_ports(self, output_data):
		world = self.device.world
		food_index = 0
		for port in self.device_info['ports']:
			if port not in self.port_map:
				continue
			label = self.port_map[port]
			if port == self.primary_port:
				value = self._convert(world.pit_temp_f())
				self.output_data['primary'][label] = value
			elif port in self.food_ports:
				value = self._convert(world.food_temp_f(food_index))
				food_index += 1
				self.output_data['food'][label] = value
			elif port in self.aux_ports:
				value = self._convert(world.food_temp_f(food_index))
				food_index += 1
				self.output_data['aux'][label] = value
			else:
				continue
			self.port_queues[port].enqueue(value)
			self.output_data['tr'][label] = 0
		return self.output_data
