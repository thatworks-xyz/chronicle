import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ActionTarget, ChangeEvent } from '../domain/change-event.js';
import { ConnectorTraitsRegistry } from '../domain/connector.js';
import { ChangeActionType, ChangeType, ScorerName, UserMentionType } from '../domain/filters.js';
import { WorkItem } from '../domain/work-item.js';
import { generateChangelogSummary } from './changelog-summary.js';
import { scoreItems } from './scoring/scoring.js';

function makeItem(uuid: string): WorkItem {
    return {
        uuid,
        userId: 'user-1',
        connector: 'my-crm',
        idsFromConnector: {
            idFromConnector: uuid,
            connectorObjectType: 'task',
            connectorUserId: 'acct-1',
        },
        title: `Item ${uuid}`,
        createdBy: [],
        createdDate: new Date('2026-01-01'),
        properties: [],
        parents: [],
        types: [],
    };
}

function makeEvent(itemUuid: string, timestamp: Date, simple: string): ChangeEvent {
    return {
        timestamp,
        itemUuid,
        userId: 'user-1',
        connector: 'my-crm',
        idsFromConnector: {
            idFromConnector: itemUuid,
            connectorObjectType: 'task',
            connectorUserId: 'acct-1',
        },
        action: {
            changeType: ChangeType.Item,
            actionType: ChangeActionType.Updated,
            userMentionType: UserMentionType.None,
            actionTarget: ActionTarget.Task,
            actorDisplayName: 'Alex',
            actorIsUser: false,
            description: { simple },
        },
    };
}

describe('changelog-summary (flat ChangeEvent path)', () => {
    it('summarizes grouped change events with actors and time ranges', async () => {
        const traits = new ConnectorTraitsRegistry();
        const item = makeItem('item-1');
        const t1 = new Date('2026-02-01T10:00:00Z');
        const t2 = new Date('2026-02-02T10:00:00Z');
        const summary = await generateChangelogSummary(
            [
                {
                    item,
                    changes: [makeEvent('item-1', t2, 'Updated'), makeEvent('item-1', t1, 'Updated')],
                },
            ],
            traits,
        );

        assert.equal(summary.length, 1);
        assert.equal(summary[0].itemUuid, 'item-1');
        assert.equal(summary[0].changes.length, 1);
        const change = summary[0].changes[0];
        assert.equal(change.actors, 'by Alex');
        assert.equal(change.timeRange.newest.toISOString(), t2.toISOString());
        assert.equal(change.timeRange.oldest.toISOString(), t1.toISOString());
        // "2" occurrences of the same action get an action count in the description
        assert.ok(
            change.description
                .map((d) => d.value)
                .join(' ')
                .includes('Updated'),
        );
    });
});

describe('scoring (flat ChangeEvent path)', () => {
    it('scores items with the default weights', () => {
        const item = makeItem('item-1');
        const from = new Date('2026-02-01T00:00:00Z');
        const to = new Date('2026-02-10T00:00:00Z');
        const scores = scoreItems(
            [
                {
                    item,
                    changes: [makeEvent('item-1', new Date('2026-02-05T00:00:00Z'), 'Updated')],
                },
            ],
            from,
            to,
            {
                [ScorerName.ActionRecency]: 0.1,
                [ScorerName.Priority]: 0.2,
                [ScorerName.NumOfComments]: 0.2,
                [ScorerName.Activity]: 0.5,
                [ScorerName.NumUniquePeople]: 0,
            },
        );

        const s = scores.get('item-1');
        assert.notEqual(s, undefined);
        assert.ok((s?.totalScore ?? 0) > 0);
        assert.ok(s?.featureScores.map((f) => f.name).includes(ScorerName.Activity));
    });
});
