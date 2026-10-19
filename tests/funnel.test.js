import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, reachedIndex, ratio, formatRate, funnelByOwner, countByStage } from '../src/lib/funnel.js';

const opp = (stage, extra = {}) => ({ id: `${stage}-${Math.random()}`, stage, ...extra });

test('hand-computed funnel: 10 leads across every stage', () => {
  // 2 not contacted, 2 contacted, 1 replied, 1 qualified, 1 meeting booked, 1 proposal, 1 won, 1 lost after replied
  const opps = [
    opp('not_contacted'), opp('not_contacted'), opp('contacted'), opp('contacted'), opp('replied'),
    opp('qualified'), opp('meeting_booked'), opp('proposal'), opp('won'), opp('lost', { lostFromStage: 'replied' }),
  ];
  const { counts, rates } = computeFunnel(opps);
  // contacted = everything except the 2 not contacted = 8
  // replied   = replied, qualified, meeting, proposal, won, lost(after replied) = 6
  // qualified = qualified, meeting, proposal, won = 4
  // meetings  = meeting, proposal, won = 3
  assert.deepEqual(
    { total: counts.total, contacted: counts.contacted, replied: counts.replied, qualified: counts.qualified, meetings: counts.meetings, won: counts.won, lost: counts.lost, open: counts.open },
    { total: 10, contacted: 8, replied: 6, qualified: 4, meetings: 3, won: 1, lost: 1, open: 8 },
  );
  assert.equal(rates.outreach.value, 8 / 10); // 80%
  assert.equal(rates.reply.value, 6 / 8); // 75%
  assert.equal(rates.qualified.value, 4 / 6); // 66.7%
  assert.equal(rates.meeting.value, 3 / 4); // 75%
  assert.equal(rates.overallMeeting.value, 3 / 8); // 37.5%
  assert.equal(rates.win.value, 1 / 2);
  assert.equal(formatRate(rates.outreach), '80.0%');
  assert.equal(formatRate(rates.qualified), '66.7%');
  assert.equal(formatRate(rates.overallMeeting), '37.5%');
  assert.deepEqual([rates.reply.numerator, rates.reply.denominator], [6, 8]);
});

test('second hand-computed case: 4 contacted, 1 replied, none qualified', () => {
  const opps = [opp('contacted'), opp('contacted'), opp('lost'), opp('replied'), opp('not_contacted')];
  const { counts, rates } = computeFunnel(opps);
  assert.equal(counts.contacted, 4); // lost with no lostFromStage counts as contacted
  assert.equal(counts.replied, 1);
  assert.equal(rates.outreach.value, 4 / 5);
  assert.equal(rates.reply.value, 1 / 4);
  assert.equal(rates.qualified.value, 0); // 0 ÷ 1 = 0%, a real zero
  assert.equal(formatRate(rates.qualified), '0.0%');
  assert.equal(rates.meeting.value, null); // 0 ÷ 0 → n/a
  assert.equal(formatRate(rates.meeting), 'n/a');
});

test('divide-by-zero gives null and displays n/a, never 0%', () => {
  const empty = computeFunnel([]);
  for (const k of ['outreach', 'reply', 'qualified', 'meeting', 'overallMeeting', 'win']) {
    assert.equal(empty.rates[k].value, null, k);
    assert.equal(formatRate(empty.rates[k]), 'n/a');
  }
  const onlyNew = computeFunnel([opp('not_contacted')]);
  assert.equal(onlyNew.rates.outreach.value, 0);
  assert.equal(formatRate(onlyNew.rates.reply), 'n/a');
  assert.deepEqual(ratio(0, 0), { numerator: 0, denominator: 0, value: null });
  assert.equal(formatRate(null), 'n/a');
});

test('reachedIndex: ladder positions, lost uses lostFromStage, unknown stage = 0', () => {
  assert.equal(reachedIndex({ stage: 'not_contacted' }), 0);
  assert.equal(reachedIndex({ stage: 'proposal' }), 5);
  assert.equal(reachedIndex({ stage: 'won' }), 6);
  assert.equal(reachedIndex({ stage: 'lost', lostFromStage: 'meeting_booked' }), 4);
  assert.equal(reachedIndex({ stage: 'lost', lostFromStage: 'nonsense' }), 1);
  assert.equal(reachedIndex({ stage: 'weird' }), 0);
});

test('funnelByOwner groups blank owners as Unassigned (listed last) and countByStage covers all stages', () => {
  const opps = [opp('contacted', { owner: 'Priya' }), opp('replied', { owner: 'Priya' }), opp('won', { owner: ' ' }), opp('not_contacted', { owner: 'Elena' })];
  const groups = funnelByOwner(opps);
  assert.deepEqual(groups.map((g) => g.owner), ['Elena', 'Priya', 'Unassigned']);
  const priya = groups[1];
  assert.equal(priya.counts.contacted, 2);
  assert.equal(priya.rates.reply.value, 1 / 2);
  const c = countByStage(opps);
  assert.equal(Object.keys(c).length, 8);
  assert.equal(c.won, 1);
  assert.equal(c.lost, 0);
});
