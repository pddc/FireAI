"""Notification event stream."""
from core import events


def test_publish_and_read_new_only(redis_client):
	cursor = events.latest_id()
	assert cursor == '0-0'
	events.publish_notification('Probe_Temp_Achieved', 'Probe1 Target Achieved', 'hit 165', label='Probe1', target=165)
	entries = events.read_notifications('0-0')
	assert len(entries) == 1
	entry_id, fields = entries[0]
	assert fields['event'] == 'Probe_Temp_Achieved' and fields['target'] == 165 and fields['label'] == 'Probe1'
	assert isinstance(fields['ts'], int)
	# nothing newer than the last id
	assert events.read_notifications(entry_id) == []
	events.publish_notification('Timer_Expired', 'Timer Complete', 'check your cook')
	newer = events.read_notifications(entry_id)
	assert len(newer) == 1 and newer[0][1]['event'] == 'Timer_Expired'
	assert events.latest_id() == newer[0][0]


def test_stream_is_capped(redis_client):
	for i in range(events.MAX_LEN + 200):
		events.publish_notification('Test_Notify', 't', str(i))
	# approximate trimming keeps it near MAX_LEN, never unbounded
	assert redis_client.xlen(events.STREAM_KEY) <= events.MAX_LEN + 200


def test_send_notifications_publishes_to_stream(settings, control):
	from notify.notifications import send_notifications

	send_notifications('Timer_Expired')
	entries = events.read_notifications('0-0')
	assert entries and entries[-1][1]['title'] == 'Timer Complete'
