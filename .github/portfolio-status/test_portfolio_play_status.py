import unittest
from portfolio_play_status import collect, validate, APPS, TRACKS

class PlayStatusTests(unittest.TestCase):
    def test_track_and_states(self):
        package=APPS["pack-one"]
        def get(path):
            self.assertEqual(path,f"/applications/{package}/tracks/internal/releases")
            return {"releases":[{"track":"internal","releaseName":"do not export","releaseLifecycleState":"RELEASE_LIFECYCLE_STATE_DRAFT","activeArtifacts":[{"versionCode":14}]},
                {"track":"internal","releaseLifecycleState":"RELEASE_LIFECYCLE_STATE_PUBLISHED","activeArtifacts":[{"versionCode":2}]}]}
        self.assertEqual(collect(package,"internal",get),{"result":"ok","releases":[{"state":"DRAFT","codes":["14"]},{"state":"PUBLISHED","codes":["2"]}]})
    def test_failure_is_not_empty_track(self):
        self.assertEqual(collect(APPS["pack-one"],"production",lambda _:None)["result"],"unavailable")
        self.assertEqual(collect(APPS["pack-one"],"production",lambda _:{"releases":[]}),{"result":"ok","releases":[]})
    def test_validation_rejects_raw_data(self):
        doc={"schema_version":1,"checked_at":"2026-11-26T00:00:00Z","run_id":"123",
             "apps":{k:{"package":v,"tracks":{t:{"result":"ok","releases":[]} for t in TRACKS}} for k,v in APPS.items()}}
        validate(doc)
        doc["apps"]["pack-one"]["tracks"]["internal"]["raw"]="not allowed"
        with self.assertRaises(AssertionError):
            validate(doc)
if __name__=="__main__":
    unittest.main()
