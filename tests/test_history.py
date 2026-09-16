"""Current temps and history ring buffer in Redis."""
from common import common


def sample(p=225, f1=100, psp=225):
	return {
		'probe_history': {'primary': {'Grill': p}, 'food': {'Probe1': f1}, 'aux': {}, 'tr': {}},
		'primary_setpoint': psp,
		'notify_targets': {'Grill': 0, 'Probe1': 165},
	}


def test_write_and_read_current(control):
	common.write_current(sample())
	cur = common.read_current()
	assert cur['P']['Grill'] == 225
	assert cur['F']['Probe1'] == 100
	assert cur['PSP'] == 225
	assert cur['NT']['Probe1'] == 165
	assert cur['TS'] > 0


def test_zero_out_builds_structure_from_probe_map(control):
	cur = common.read_current(zero_out=True)
	assert 'Grill' in cur['P']
	assert all(v == 0 for v in cur['P'].values())


def test_history_ring_buffer_caps_length(control, redis_client):
	for i in range(10):
		common.write_history(sample(p=200 + i), maxsizelines=5)
	assert redis_client.llen('control:history') == 5
	rows = common.read_history()
	assert len(rows) == 5


def test_read_history_num_items_returns_tail(control):
	for i in range(6):
		common.write_history(sample(p=i))
	rows = common.read_history(num_items=2)
	assert len(rows) == 2


def test_flush_history(control, redis_client):
	common.write_history(sample())
	common.read_history(flushhistory=True)
	assert redis_client.llen('control:history') == 0
