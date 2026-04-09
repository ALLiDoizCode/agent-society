# Akash SDL Reference

## Table of Contents
- SDL Structure Overview
- Services Section
- Profiles Section (Compute + Placement)
- Deployment Section
- Persistent Storage
- IP Leases
- GPU Resources
- Validation Rules
- Minimal Template
- Common SDL Examples

## SDL Structure Overview

SDL (Stack Definition Language) is YAML-based, version `"2.0"`, similar to Docker Compose. Files use `.yml` or `.yaml` extension.

Four required top-level sections:
```yaml
version: "2.0"
services:    # Container workloads
profiles:    # Compute resources + placement/pricing
deployment:  # Maps services to profiles
```

Optional top-level: `endpoints` (for IP leases).

## Services Section

```yaml
services:
  web:
    image: nginx:latest          # Required: Docker image
    command: ["nginx"]           # Optional: override entrypoint
    args: ["-g", "daemon off;"]  # Optional: command arguments
    env:                         # Optional: environment variables
      - API_KEY=0xcafebabe
      - CLIENT_ID=0xdeadbeef
    expose:                      # Optional: port exposure
      - port: 80                 # Required: container port
        as: 80                   # Optional: external port mapping
        proto: http              # Optional: tcp|http|https (default: 80→http, 443→https, else→tcp)
        to:
          - global: true         # Expose externally (at least one port must be global)
      - port: 5432
        to:
          - service: db          # Expose only to another service in this deployment
    depends-on:                  # Optional: startup ordering
      - db
    params:                      # Optional: storage mounts (for persistent storage)
      storage:
        data:
          mount: /data           # MUST be absolute path
          readOnly: false
```

## Profiles Section

### Compute Profiles

```yaml
profiles:
  compute:
    web:
      resources:
        cpu:
          units: 0.5           # vCPU share (fractional or milli: "500m" = 0.5)
        memory:
          size: 512Mi          # Suffixes: Ki, Mi, Gi, Ti (binary) or K, M, G, T (SI)
        storage:
          - size: 1Gi          # Local ephemeral storage (required)
          - name: data         # Named persistent volume
            size: 10Gi
            attributes:
              persistent: true
              class: beta2     # Storage class
```

CPU: `1` = 1 vCPU, `0.5` = half, `"100m"` = 1/10 vCPU.
Memory/Storage suffixes: k(1000), Ki(1024), M(10^6), Mi(2^20), G(10^9), Gi(2^30), T(10^12), Ti(2^40).

### Placement Profiles

```yaml
  placement:
    dcloud:
      attributes:
        region: us-west        # Optional: datacenter attributes
      signedBy:                # Optional: auditor verification
        allOf:
          - "akash1..."        # All of these must have signed
        anyOf:
          - "akash1..."        # At least one must have signed
      pricing:
        web:                   # Must match a compute profile name
          denom: uakt          # Token denomination (1 AKT = 1,000,000 uakt)
          amount: 1000         # Max price per block you're willing to pay
```

## Deployment Section

```yaml
deployment:
  web:                         # Must match a service name
    dcloud:                    # Must match a placement profile name
      profile: web             # Must match a compute profile name
      count: 1                 # Number of instances
```

## Persistent Storage

Max 2 volumes per profile. Define in `profiles.compute` and mount in `services.params.storage`.

```yaml
services:
  app:
    image: myapp:latest
    params:
      storage:
        data:
          mount: /var/data     # Absolute path required
          readOnly: false
profiles:
  compute:
    app:
      resources:
        cpu: { units: 1 }
        memory: { size: 1Gi }
        storage:
          - size: 512Mi                        # Ephemeral (required)
          - name: data                          # Persistent volume
            size: 10Gi
            attributes:
              persistent: true
              class: beta2
```

**Limitations:** Data does NOT survive provider migration or lease expiry. Back up critical data externally.

## IP Leases

Add top-level `endpoints` section for dedicated IPv4:

```yaml
---
version: "2.0"
endpoints:
  myip:
    kind: ip                   # Only valid option
services:
  web:
    image: nginx:latest
    expose:
      - port: 80
        as: 80
        to:
          - global: true
            ip: myip           # Bind to the dedicated IP endpoint
```

Endpoint names must be unique per provider across all your deployments.

## GPU Resources

```yaml
profiles:
  compute:
    gpu-worker:
      resources:
        cpu: { units: 4 }
        memory: { size: 16Gi }
        storage: { size: 100Gi }
        gpu:
          units: 1
          attributes:
            vendor:
              nvidia:
                - model: a100
```

## Validation Rules

These will cause deployment creation to fail:
- Persistent storage mount path is relative (must be absolute, e.g., `/data` not `data`)
- Persistent storage name in `profiles` doesn't match name in `services.params.storage`
- Same mount point used for multiple persistent volumes
- `params.storage` section missing volume name or mount point
- Version is not `"2.0"`
- No port with `global: true` (deployment unreachable externally)
- Compute profile referenced in deployment doesn't exist
- Placement profile referenced in deployment doesn't exist

## Minimal Template

```yaml
---
version: "2.0"
services:
  web:
    image: nginx:latest
    expose:
      - port: 80
        as: 80
        to:
          - global: true
profiles:
  compute:
    web:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 1Gi
  placement:
    dcloud:
      pricing:
        web:
          denom: uakt
          amount: 1000
deployment:
  web:
    dcloud:
      profile: web
      count: 1
```

## Common SDL Examples

**Web app + Database:**
```yaml
---
version: "2.0"
services:
  web:
    image: myapp:latest
    env:
      - DATABASE_URL=postgres://user:pass@db:5432/mydb
    expose:
      - port: 3000
        as: 80
        to:
          - global: true
    depends-on:
      - db
  db:
    image: postgres:15
    env:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb
    expose:
      - port: 5432
        to:
          - service: web
    params:
      storage:
        pgdata:
          mount: /var/lib/postgresql/data
          readOnly: false
profiles:
  compute:
    web:
      resources:
        cpu: { units: 1 }
        memory: { size: 1Gi }
        storage: { size: 2Gi }
    db:
      resources:
        cpu: { units: 1 }
        memory: { size: 2Gi }
        storage:
          - size: 1Gi
          - name: pgdata
            size: 20Gi
            attributes:
              persistent: true
              class: beta2
  placement:
    dcloud:
      pricing:
        web:
          denom: uakt
          amount: 1000
        db:
          denom: uakt
          amount: 2000
deployment:
  web:
    dcloud:
      profile: web
      count: 1
  db:
    dcloud:
      profile: db
      count: 1
```

**GPU AI Inference:**
```yaml
---
version: "2.0"
services:
  inference:
    image: vllm/vllm-openai:latest
    env:
      - MODEL=meta-llama/Llama-3.3-70B
    expose:
      - port: 8000
        as: 8000
        to:
          - global: true
profiles:
  compute:
    inference:
      resources:
        cpu: { units: 8 }
        memory: { size: 32Gi }
        storage: { size: 100Gi }
        gpu:
          units: 1
          attributes:
            vendor:
              nvidia:
                - model: a100
  placement:
    dcloud:
      pricing:
        inference:
          denom: uakt
          amount: 10000
deployment:
  inference:
    dcloud:
      profile: inference
      count: 1
```

For 290+ more examples, see: https://github.com/akash-network/awesome-akash
