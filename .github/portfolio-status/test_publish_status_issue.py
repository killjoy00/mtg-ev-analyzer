import unittest
import publish_status_issue as publisher

class PublishStatusTests(unittest.TestCase):
    def doc(self):
        return {"schema_version":1,"checked_at":"2026-11-26T20:00:00Z","run_id":"123","apps":{"pack-one":{"bundle":"pro.packone.app","result":"ok","builds":[],"versions":[]}}}
    def body(self):
        return "Status\n\n<!-- portfolio-status:start -->\n"+chr(96)*3+"json\n{}\n"+chr(96)*3+"\n<!-- portfolio-status:end -->\n"
    def test_validated_update(self):
        value=publisher.merge(self.body(),{"apple":self.doc()},"123")
        self.assertEqual(publisher.parse(value),{"apple":self.doc()})
        self.assertTrue(value.startswith("Status"))
    def test_wrong_run_and_raw_data_rejected(self):
        with self.assertRaises(ValueError):
            publisher.merge(self.body(),{"apple":self.doc()},"456")
        value=self.doc()
        value["raw"]="not allowed"
        with self.assertRaises(AssertionError):
            publisher.merge(self.body(),{"apple":value},"123")
    def test_reject_unrelated_issue(self):
        with self.assertRaises(ValueError):
            publisher.merge("unrelated",{"apple":self.doc()},"123")
