Pod::Spec.new do |s|
  s.name = 'PackOneAdMobPrivacy'
  s.version = '1.0.0'
  s.summary = 'Configures supported native ad privacy controls for Pack One QA.'
  s.homepage = 'https://packone.pro'
  s.license = { :type => 'Proprietary' }
  s.author = 'Pack One'
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/killjoy00/mtg-ev-analyzer.git' }
  s.source_files = '*.swift'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'Google-Mobile-Ads-SDK'
end
