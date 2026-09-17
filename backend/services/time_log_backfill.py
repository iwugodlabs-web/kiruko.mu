"""One-time historical classification backfill SQL (review-by-exception).

A SQL mirror of ``services.time_log_classifier.classify_exceptions``, used by
migration ``timelog_needs_review_20260917`` to classify pre-existing rows in the
same atomic migration (no separate script step). The Python classifier remains
the source of truth for ongoing writes; this is a frozen, one-time pass.

Importable so the migration and the agreement test share the exact SQL.
"""

BACKFILL_REASONS_SQL = """
UPDATE time_logs
SET exception_reasons = array_remove(ARRAY[
    CASE WHEN auto_closed THEN 'auto_closed' END,
    CASE WHEN out_of_geofence THEN 'out_of_geofence' END,
    CASE WHEN out_of_schedule THEN 'out_of_schedule' END,
    CASE WHEN is_late THEN 'late' END,
    CASE WHEN is_overtime AND NOT COALESCE(overtime_confirmed_by_employer, false)
         THEN 'overtime_unconfirmed' END,
    CASE WHEN COALESCE((geofence_check_json->>'mock_detected')::boolean, false)
              OR geofence_check_json->>'reason' = 'mock_detected'
         THEN 'mock_location' END,
    CASE WHEN geofence_check_json->>'reason' = 'unverifiable_accuracy'
              OR COALESCE((geofence_check_json->>'accuracy_m')::numeric, 0) > 150
         THEN 'low_accuracy' END,
    CASE WHEN EXISTS (SELECT 1 FROM time_log_disputes d
                      WHERE d.time_log_id = time_logs.timelog_id
                        AND d.resolution = 'pending')
         THEN 'disputed' END,
    CASE WHEN COALESCE((geofence_check_json->>'time_skew')::boolean, false)
         THEN 'time_skew' END
], NULL)
WHERE needs_review IS NULL;

UPDATE time_logs
SET needs_review = (cardinality(exception_reasons) > 0)
WHERE needs_review IS NULL;
"""
