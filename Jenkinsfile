pipeline {
    agent any

    environment {
        REPORT_EMAIL_FROM = credentials('REPORT_EMAIL_FROM')
        REPORT_EMAIL_TO   = credentials('REPORT_EMAIL_TO')
        SMTP_HOST         = credentials('SMTP_HOST')
        SMTP_PORT         = credentials('SMTP_PORT')
        SMTP_USER         = credentials('SMTP_USER')
        SMTP_PASS         = credentials('SMTP_PASS')
    }

    stages {
        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Run GCP Cost Report') {
            steps {
                sh 'node gcp-cost-report.js'
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: '*.csv, input.xlsx', allowEmptyArchive: true
            cleanWs()
        }
        failure {
            echo 'Pipeline failed. Check the logs for details.'
        }
    }
}
