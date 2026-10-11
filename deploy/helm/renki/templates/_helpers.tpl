{{- define "renki.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "renki.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "renki.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "renki.daemonName" -}}{{ include "renki.fullname" . }}-daemon{{- end -}}
{{- define "renki.webName" -}}{{ include "renki.fullname" . }}-web{{- end -}}

{{- define "renki.secretName" -}}
{{- .Values.existingSecret | default (include "renki.fullname" .) -}}
{{- end -}}

{{- define "renki.image" -}}
{{- printf "%s:%s" .image.repository (.image.tag | default .appVersion) -}}
{{- end -}}
