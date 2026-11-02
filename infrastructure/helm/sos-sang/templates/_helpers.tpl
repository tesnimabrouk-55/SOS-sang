{{- define "sos.labels" -}}
app.kubernetes.io/part-of: sos-sang
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "sos.secretName" -}}
{{- if .Values.secrets.existingSecret -}}{{ .Values.secrets.existingSecret }}{{- else -}}sos-secrets{{- end -}}
{{- end -}}

{{- define "sos.replicas" -}}
{{- if eq .Values.profile "local" -}}1{{- else -}}{{ if .critical }}2{{ else }}2{{ end }}{{- end -}}
{{- end -}}
