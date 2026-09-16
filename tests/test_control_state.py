"""Redis-backed control structure: defaults, queued writes, deep_update semantics."""
from common import common


def test_default_control_shape():
	c = common.default_control()
	assert c['mode'] == 'Stop'
	assert c['primary_setpoint'] == 0
	assert 'notify_data' in c and 'timer' in c and 'safety' in c


def test_read_control_flush_writes_defaults(control, redis_client):
	assert redis_client.exists('control:general')
	assert control['mode'] == 'Stop'


def test_queued_write_is_applied_by_execute_control_writes(control, redis_client):
	common.write_control({'mode': 'Smoke'}, direct_write=False, origin='test')
	assert redis_client.llen('control:write') == 1
	assert common.read_control()['mode'] == 'Stop'  # not yet applied
	assert common.execute_control_writes() == 'OK'
	assert redis_client.llen('control:write') == 0
	after = common.read_control()
	assert after['mode'] == 'Smoke'
	assert 'origin' not in after
	assert after['primary_setpoint'] == 0  # untouched keys preserved


def test_direct_write_bypasses_queue(control, redis_client):
	control['mode'] = 'Hold'
	common.write_control(control, direct_write=True, origin='test')
	assert redis_client.llen('control:write') == 0
	assert common.read_control()['mode'] == 'Hold'


def test_multiple_queued_writes_apply_in_order(control):
	common.write_control({'mode': 'Startup'}, origin='a')
	common.write_control({'mode': 'Smoke', 'primary_setpoint': 225}, origin='b')
	common.execute_control_writes()
	c = common.read_control()
	assert c['mode'] == 'Smoke' and c['primary_setpoint'] == 225


def test_deep_update_merges_nested_without_clobbering():
	base = {'a': {'x': 1, 'y': 2}, 'b': 1}
	out = common.deep_update(base, {'a': {'y': 3}, 'c': 4})
	assert out == {'a': {'x': 1, 'y': 3}, 'b': 1, 'c': 4}
	assert out is base


def test_deep_update_replaces_lists_wholesale():
	base = {'l': [1, 2, 3]}
	assert common.deep_update(base, {'l': [9]})['l'] == [9]


def test_errors_and_warnings_roundtrip(control):
	common.write_errors(['boom'])
	assert common.read_errors() == ['boom']
	assert common.read_errors(flush=True) == []
	common.write_warning('careful')
	assert 'careful' in common.read_warnings()
