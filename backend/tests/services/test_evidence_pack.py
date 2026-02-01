from app.services.skill_registry.evidence_pack import EvidencePack


def test_evidence_pack_limits_files():
    pack = EvidencePack(files=[f"file_{i}.py" for i in range(20)])
    assert pack.file_count <= pack.max_files
