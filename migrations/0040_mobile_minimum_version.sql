INSERT INTO settings(key,value)
VALUES (
  'mobile_minimum_supported_versions_v1',
  '{"ios":{"marketingVersion":"1.0","build":1},"android":{"marketingVersion":"1.0","build":1}}'
)
ON CONFLICT (key) DO NOTHING;
