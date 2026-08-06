# Security Policy

## Overview

Security and user privacy are core principles of Internlog. We take responsible disclosure seriously and appreciate security researchers, developers, and users who help identify potential vulnerabilities.

Internlog follows secure software development practices including:
- Secure handling of user-submitted data
- Input validation and sanitization
- Rate limiting and abuse prevention
- Protection of sensitive environment variables
- Dependency monitoring
- Responsible vulnerability disclosure

---

# Supported Versions

The following versions of Internlog currently receive security updates:

| Version | Supported |
| ------- | --------- |
| Latest release | ✅ |
| Previous major release | ⚠️ Limited security fixes |
| Older versions | ❌ |

Security fixes are prioritized for the latest production version of the application.

---

# Reporting a Vulnerability

If you discover a security vulnerability in Internlog, please report it responsibly.

## How to Report

Please report security issues through:

- GitHub Private Vulnerability Reporting (preferred)
- GitHub Security Advisories
- Direct contact with the project maintainers

Please do **not** publicly disclose security vulnerabilities before they have been reviewed and addressed.

---

# What to Include

When submitting a vulnerability report, please include:

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential security impact
- Affected components or files
- Suggested remediation (if available)
- Any relevant screenshots, logs, or proof-of-concept details

---

# Response Timeline

We aim to follow the following response process:

| Stage | Expected Timeline |
| ----- | ---------------- |
| Initial acknowledgement | Within 48 hours |
| Vulnerability assessment | Within 5 business days |
| Security update or mitigation plan | As soon as practical |
| Public disclosure (if applicable) | After remediation |

---

# Scope

Security reports related to the following areas are welcome:

✅ Authentication and authorization issues  
✅ Data exposure vulnerabilities  
✅ Injection vulnerabilities  
✅ Cross-site scripting (XSS)  
✅ Cross-site request forgery (CSRF)  
✅ Server-side vulnerabilities  
✅ Dependency vulnerabilities  
✅ API security issues  
✅ Privacy-related concerns  

---

# Out of Scope

The following issues are generally not considered security vulnerabilities:

- Reports without a reproducible example
- Social engineering attacks
- Spam or abuse reports
- Vulnerabilities requiring physical access
- Issues affecting outdated unsupported versions

---

# Responsible Disclosure

We ask security researchers to:

- Avoid accessing or modifying other users' data
- Avoid disrupting service availability
- Avoid testing against production users
- Give maintainers reasonable time to investigate and resolve issues

We appreciate responsible security researchers who help improve Internlog and protect the community.

---

# Security Recognition

Researchers who responsibly report valid vulnerabilities may be recognized in project acknowledgements after the issue has been resolved.

---

# Security Tooling & Development Practices

Internlog uses automated security tooling and secure development practices to identify and reduce potential vulnerabilities throughout the development lifecycle.

## Automated Security Checks

The project utilizes:

- **GitHub CodeQL** - Static application security testing (SAST) to analyze source code for potential vulnerabilities and insecure coding patterns.
- **GitHub Dependabot** - Automated dependency monitoring to identify outdated or vulnerable third-party packages.
- **GitHub Actions CI/CD** - Automated workflows to improve code quality, reliability, and security during development.
- **npm Audit** - Dependency vulnerability scanning for Node.js packages.

## Secure Development Practices

Internlog follows security-focused engineering practices including:

- Secure environment variable management
- Avoiding exposure of credentials and sensitive information
- Input validation and sanitization
- Rate limiting to reduce abuse and automated attacks
- Least privilege principles
- Regular dependency updates
- Security-focused code reviews

These practices help maintain a safer and more reliable platform as Internlog continues to grow.
