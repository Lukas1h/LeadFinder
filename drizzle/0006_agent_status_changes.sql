-- Status history for agents (agent_status_changes in src/db/schema.ts).
-- drizzle-kit push creates the table; this adds the trigger that fills it and
-- is safe to rerun. Apply with: npx tsx --env-file=.env.local scripts/apply-sql.mts <this file>

CREATE OR REPLACE FUNCTION record_agent_status_change() RETURNS trigger AS $$
DECLARE
  win constant interval := interval '14 days';
  oi record;
  ms record;
  ii record;
  verdict text;
BEGIN
  -- The latest outreach that went out (a "didn't send" text doesn't count).
  SELECT id, channel, follow_up_feed, occurred_at INTO oi
  FROM agent_interactions
  WHERE agent_id = NEW.id AND direction = 'outbound'
    AND outcome IS DISTINCT FROM 'not_sent' AND pending_since IS NULL
    AND occurred_at > now() - win
  ORDER BY occurred_at DESC LIMIT 1;

  SELECT s.id, s.preset_id, s.sent_at, p.name INTO ms
  FROM message_sends s LEFT JOIN message_presets p ON p.id = s.preset_id
  WHERE s.agent_id = NEW.id AND s.sent_at > now() - win
  ORDER BY s.sent_at DESC LIMIT 1;

  SELECT id INTO ii
  FROM agent_interactions
  WHERE agent_id = NEW.id AND direction = 'inbound' AND occurred_at > now() - win
  ORDER BY occurred_at DESC LIMIT 1;

  -- Whichever is newer wins; a feed text and its send land within a minute.
  IF oi.id IS NOT NULL AND oi.follow_up_feed IS NOT NULL
     AND (ms.id IS NULL OR oi.occurred_at >= ms.sent_at - interval '1 minute') THEN
    verdict := 'feed:' || oi.follow_up_feed;
  ELSIF ms.id IS NOT NULL AND (oi.id IS NULL OR ms.sent_at >= oi.occurred_at - interval '1 minute') THEN
    verdict := 'template:' || coalesce(ms.name, 'unknown');
  ELSIF oi.id IS NOT NULL THEN
    verdict := 'outreach:' || oi.channel;
  ELSE
    verdict := 'manual';
  END IF;

  INSERT INTO agent_status_changes
    (agent_id, from_status, to_status, attribution, follow_up_feed, preset_id, message_send_id,
     outbound_interaction_id, inbound_interaction_id)
  VALUES
    (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.relationship_status END, NEW.relationship_status, verdict,
     oi.follow_up_feed, ms.preset_id, ms.id, oi.id, ii.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_status_changed ON agents;
CREATE TRIGGER agent_status_changed
  AFTER UPDATE OF relationship_status ON agents
  FOR EACH ROW WHEN (OLD.relationship_status IS DISTINCT FROM NEW.relationship_status)
  EXECUTE FUNCTION record_agent_status_change();

DROP TRIGGER IF EXISTS agent_status_set_on_create ON agents;
CREATE TRIGGER agent_status_set_on_create
  AFTER INSERT ON agents
  FOR EACH ROW WHEN (NEW.relationship_status <> 'cold')
  EXECUTE FUNCTION record_agent_status_change();
