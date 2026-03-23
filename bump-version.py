import json
import re
import sys
from pathlib import Path

def bump_json_version(filepath: Path, new_version: str):
    if not filepath.exists():
        print(f"File not found: {filepath}")
        sys.exit(1)
        
    try:
        content = filepath.read_text(encoding="utf-8")
        data = json.loads(content)
        old_version = data.get("version", "unknown")
        data["version"] = new_version
        
        # Write back with the same formatting
        filepath.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        print(f"Updated {filepath} ({old_version} -> {new_version})")
    except Exception as e:
        print(f"Failed to update {filepath}: {e}")
        sys.exit(1)

def bump_toml_version(filepath: Path, new_version: str):
    if not filepath.exists():
        print(f"File not found: {filepath}")
        sys.exit(1)
        
    try:
        content = filepath.read_text(encoding="utf-8")
        
        # Simple regex replacement for top-level version
        new_content = re.sub(
            r'^version\s*=\s*"[^"]*"', 
            f'version = "{new_version}"', 
            content, 
            flags=re.MULTILINE,
            count=1  # Only replace the first occurrence (package version)
        )
        
        if content == new_content:
            print(f"Warning: Could not find version field to update in {filepath}")
        else:
            filepath.write_text(new_content, encoding="utf-8")
            print(f"Updated {filepath} (-> {new_version})")
    except Exception as e:
        print(f"Failed to update {filepath}: {e}")
        sys.exit(1)

def main():
    if len(sys.argv) != 2:
        print("Usage: python bump-version.py <new_version>")
        print("Example: python bump-version.py 0.1.0-4")
        sys.exit(1)
        
    new_version = sys.argv[1].lstrip('v')  # Remove 'v' if user passed 'v0.1.0-4'
    
    files_to_update = [
        ("deeting/package.json", bump_json_version),
        ("deeting/src-tauri/tauri.conf.json", bump_json_version),
        ("deeting/src-tauri/Cargo.toml", bump_toml_version),
        ("installer/package.json", bump_json_version),
        ("installer/src-tauri/tauri.conf.json", bump_json_version),
        ("installer/src-tauri/Cargo.toml", bump_toml_version),
    ]
    
    print(f"Bumping version to {new_version}...")
    
    # We execute from project root
    root_dir = Path(__file__).parent.resolve()
    
    for relative_path, updater_func in files_to_update:
        full_path = root_dir / relative_path
        updater_func(full_path, new_version)
        
    print("\n✅ All version files updated.")
    print(f"Next steps:")
    print(f"1. git add .")
    print(f'2. git commit -m "chore(release): v{new_version}"')
    print(f"3. .\\release-tag.cmd")

if __name__ == "__main__":
    main()
