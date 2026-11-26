import unittest
from portfolio_apple_status import collect, validate, APPS

class StoreStatusTests(unittest.TestCase):
    def test_allowlisted_result(self):
        bundle=APPS["pack-one"]
        def get(path,params=None):
            if path=="/apps":
                return {"data":[{"id":"internal-id","attributes":{"bundleId":bundle,"name":"secret name"}}]}
            if path.endswith("/appStoreVersions"):
                return {"data":[{"attributes":{"platform":"IOS","versionString":"1.3","appVersionState":"IN_REVIEW","releaseNotes":"never output"}}]}
            if path=="/builds":
                return {"data":[{"id":"build-id","attributes":{"version":"1008","processingState":"VALID","expired":False},
                  "relationships":{"preReleaseVersion":{"data":{"id":"release"}},"buildBetaDetail":{"data":{"id":"beta"}}}}],
                  "included":[{"type":"preReleaseVersions","id":"release","attributes":{"version":"1.4","platform":"IOS"}},
                  {"type":"buildBetaDetails","id":"beta","attributes":{"internalBuildState":"IN_BETA_TESTING","externalBuildState":"READY_FOR_BETA_SUBMISSION"}}]}
            self.fail("Unexpected API path")
        got=collect(bundle,get)
        self.assertEqual(got["builds"][0]["internal"],"IN_BETA_TESTING")
        self.assertEqual(got["versions"],[{"version":"1.3","state":"IN_REVIEW"}])
        self.assertNotIn("internal-id",str(got))
        self.assertNotIn("never output",str(got))
    def test_absent_record_is_not_unreleased(self):
        self.assertEqual(collect(APPS["pack-one"],lambda *args:None)["result"],"unavailable")
        self.assertEqual(collect(APPS["pack-one"],lambda *args:{"data":[]})["result"],"not_found")
    def test_validation_rejects_unexpected_fields(self):
        doc={"schema_version":1,"checked_at":"2026-11-26T00:00:00Z","run_id":"123",
             "apps":{k:{"bundle":b,"result":"unavailable","builds":[],"versions":[]} for k,b in APPS.items()}}
        validate(doc)
        doc["apps"]["pack-one"]["token"]="no"
        with self.assertRaises(AssertionError):
            validate(doc)
if __name__=="__main__":
    unittest.main()
