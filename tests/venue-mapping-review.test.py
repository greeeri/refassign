import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('mapping', Path(__file__).parents[1] / 'scripts/validate-venue-mapping-review.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MappingReviewTest(unittest.TestCase):
    def setUp(self):
        self.snapshot = {'fields': [{'location_id': 'field-a', 'current_venue_id': 'venue-a'},
                                    {'location_id': 'field-b', 'current_venue_id': None}],
                         'venues': [{'venue_id': 'venue-a'}, {'venue_id': 'venue-b'}]}

    def row(self, **overrides):
        return {'location_id': 'field-a', 'current_venue_id': 'venue-a',
                'approved_venue_id': '', 'review_note': '', **overrides}

    def test_blanks_preserve_current_link(self):
        self.assertEqual(module.validate(self.snapshot, [self.row()]), [])

    def test_unlinked_fields_never_inferred(self):
        self.assertEqual(module.validate(self.snapshot, [self.row(location_id='field-b', current_venue_id='')]), [])

    def test_reviewed_change_carries_expected_id(self):
        result = module.validate(self.snapshot, [self.row(approved_venue_id='venue-b', review_note='Confirmed by venue operator')])
        self.assertEqual(result[0]['expected_venue_id'], 'venue-a')
        self.assertEqual(result[0]['proposed_venue_id'], 'venue-b')

    def test_unknown_field_rejected(self):
        with self.assertRaisesRegex(ValueError, 'unknown field'):
            module.validate(self.snapshot, [self.row(location_id='unknown')])

    def test_duplicate_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            module.validate(self.snapshot, [self.row(), self.row()])

    def test_stale_expected_parent_rejected(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            module.validate(self.snapshot, [self.row(current_venue_id='venue-b')])

    def test_name_is_not_venue_identity(self):
        with self.assertRaisesRegex(ValueError, 'not in the snapshot'):
            module.validate(self.snapshot, [self.row(approved_venue_id='Johnston Soccer Complex')])

    def test_unconfirmed_change_rejected(self):
        with self.assertRaisesRegex(ValueError, 'reviewer note'):
            module.validate(self.snapshot, [self.row(approved_venue_id='venue-b')])


if __name__ == '__main__':
    unittest.main()
