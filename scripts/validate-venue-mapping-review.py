#!/usr/bin/env python3
"""Validate a reviewed mapping CSV against a read-only snapshot. Never connects/writes to a DB."""
import argparse
import csv
import json
import sys


def validate(snapshot, rows):
    fields = {row['location_id']: row for row in snapshot['fields']}
    venues = {row['venue_id'] for row in snapshot['venues']}
    seen, proposals = set(), []
    for number, row in enumerate(rows, 2):
        location_id = row.get('location_id', '').strip()
        if location_id not in fields:
            raise ValueError(f'Row {number}: unknown field ID; refresh the snapshot.')
        if location_id in seen:
            raise ValueError(f'Row {number}: duplicate field ID.')
        seen.add(location_id)
        current = fields[location_id].get('current_venue_id') or ''
        if row.get('current_venue_id', '').strip() != current:
            raise ValueError(f'Row {number}: expected current venue differs from the snapshot.')
        approved = row.get('approved_venue_id', '').strip()
        # Blank means not reviewed/no change, NEVER unassign or infer a venue.
        if not approved:
            continue
        if approved not in venues:
            raise ValueError(f'Row {number}: approved venue ID is not in the snapshot catalog.')
        if approved == current:
            continue
        note = row.get('review_note', '').strip()
        if not note:
            raise ValueError(f'Row {number}: an explicit reviewer note is required for a changed parent.')
        proposals.append({'location_id': location_id, 'expected_venue_id': current or None,
                          'proposed_venue_id': approved, 'review_note': note})
    return proposals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', help='Read-only snapshot.json; contains fields and venues arrays')
    parser.add_argument('review', help='Reviewed field-venue-mapping-review.csv')
    args = parser.parse_args()
    try:
        with open(args.snapshot, encoding='utf-8') as f:
            snapshot = json.load(f)
        with open(args.review, encoding='utf-8-sig', newline='') as f:
            proposals = validate(snapshot, csv.DictReader(f))
        print(json.dumps({'mode': 'review_only', 'database_writes': 0,
                          'proposal_count': len(proposals), 'proposals': proposals}, indent=2))
    except (ValueError, KeyError, OSError) as error:
        print(f'Mapping review rejected: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
