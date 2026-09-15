#!/usr/bin/env ruby

require 'yaml'

abort 'expected at most one action manifest path' if ARGV.length > 1

action_path = ARGV.fetch(0, 'action.yml')
begin
  manifest = YAML.safe_load(
    File.read(action_path),
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false
  )
rescue Errno::ENOENT => error
  abort error.message
rescue Psych::Exception => error
  abort "action.yml could not be parsed: #{error.message}"
end

abort 'action.yml must contain a mapping' unless manifest.is_a?(Hash)

inputs = manifest.fetch('inputs', {})
runs = manifest['runs']
abort 'action.yml inputs must be a mapping' unless inputs.is_a?(Hash)
abort 'action.yml runs must be a mapping' unless runs.is_a?(Hash)

steps = runs['steps']
abort 'action.yml steps must be a list of mappings' unless steps.is_a?(Array) && steps.all? { |step| step.is_a?(Hash) }

def blank_setup_env?(step)
  env = step['env']
  env.is_a?(Hash) &&
    env['COPILOT_GITHUB_TOKEN'] == '' &&
    env['GH_TOKEN'] == '' &&
    env['GITHUB_TOKEN'] == ''
end

auth_step = steps.find { |step| step['name'] == 'Require Copilot authentication' }
node_step = steps.find { |step| step['name'] == 'Set up Node.js for Copilot CLI' }
install_step = steps.find { |step| step['name'] == 'Install GitHub Copilot CLI' }
review_step = steps.find { |step| step['name'] == 'Run Gem PR Review' }
auth_run = auth_step.fetch('run', '').to_s if auth_step
install_run = install_step.fetch('run', '').to_s if install_step
expression_start = '$' + '{{ '
copilot_token_expression = expression_start + 'inputs.copilot_token }}'
github_token_expression = expression_start + 'inputs.github_token }}'

modern =
  runs['using'] == 'composite' &&
  inputs['copilot_token'].is_a?(Hash) &&
  inputs['copilot_token']['required'] == true &&
  auth_step &&
  auth_step.dig('env', 'COPILOT_GITHUB_TOKEN') == copilot_token_expression &&
  auth_run.include?('if [ -z "$COPILOT_GITHUB_TOKEN" ]') &&
  auth_run.include?('exit 1') &&
  node_step &&
  node_step['uses'] == 'actions/setup-node@v6' &&
  node_step.dig('with', 'node-version').to_s == '22' &&
  blank_setup_env?(node_step) &&
  install_step &&
  blank_setup_env?(install_step) &&
  install_run.include?('npm ci --prefix') &&
  install_run.include?('--ignore-scripts') &&
  review_step &&
  review_step.dig('env', 'COPILOT_GITHUB_TOKEN') == copilot_token_expression

legacy =
  runs['using'] == 'composite' &&
  !inputs.key?('copilot_token') &&
  steps.length == 1 &&
  review_step &&
  review_step['id'] == 'review' &&
  review_step['shell'] == 'bash' &&
  review_step.fetch('run', '').to_s.include?('scripts/ci-action.mjs') &&
  review_step.dig('env', 'GITHUB_TOKEN') == github_token_expression &&
  review_step.dig('env', 'GH_TOKEN') == github_token_expression

if modern
  puts 'modern'
elsif legacy
  puts 'legacy'
else
  abort 'action.yml has an unsupported contract'
end
