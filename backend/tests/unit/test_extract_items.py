"""Tests for _extract_items with output_mapping support."""

from app.core.provider.utils import extract_items as _extract_items


class TestExtractItemsBackwardCompat:
    """向后兼容：无 output_mapping 时走原有逻辑"""

    def test_data_key(self):
        response = {"data": [{"url": "https://a.mp4"}, {"url": "https://b.mp4"}]}
        items = _extract_items(response)
        assert len(items) == 2
        assert items[0]["url"] == "https://a.mp4"

    def test_videos_key(self):
        response = {"videos": [{"url": "https://v.mp4"}]}
        items = _extract_items(response)
        assert len(items) == 1

    def test_outputs_key(self):
        response = {"outputs": [{"url": "https://o.mp4"}]}
        items = _extract_items(response)
        assert len(items) == 1

    def test_no_matching_key(self):
        response = {"result": "something"}
        items = _extract_items(response)
        assert items == []

    def test_non_dict_response(self):
        items = _extract_items("not a dict")
        assert items == []

    def test_empty_list_returns_empty(self):
        response = {"data": []}
        items = _extract_items(response)
        assert items == []

    def test_filters_non_dict_items(self):
        response = {"data": [{"url": "a"}, "not_dict", 123]}
        items = _extract_items(response)
        assert len(items) == 1


class TestExtractItemsSingleMode:
    """单对象模式 output_mapping（如 Seedance）"""

    def test_seedance_response(self):
        """Seedance 典型响应：content.video_url"""
        response = {
            "id": "cgt-xxx",
            "status": "succeeded",
            "content": {"video_url": "https://volces.com/video.mp4"},
        }
        mapping = {
            "single_mode": {
                "enabled": True,
                "url_path": "content.video_url",
            }
        }

        items = _extract_items(response, output_mapping=mapping)
        assert len(items) == 1
        assert items[0]["url"] == "https://volces.com/video.mp4"

    def test_single_mode_with_extra_fields(self):
        """单对象模式 + 额外字段映射"""
        response = {
            "status": "succeeded",
            "content": {"video_url": "https://v.mp4"},
            "metadata": {"duration": 5.0, "width": 1920, "height": 1080},
        }
        mapping = {
            "single_mode": {
                "enabled": True,
                "url_path": "content.video_url",
                "fields": {
                    "duration": "metadata.duration",
                    "width": "metadata.width",
                    "height": "metadata.height",
                },
            }
        }

        items = _extract_items(response, output_mapping=mapping)
        assert len(items) == 1
        assert items[0]["url"] == "https://v.mp4"
        assert items[0]["duration"] == 5.0
        assert items[0]["width"] == 1920

    def test_single_mode_missing_url(self):
        """单对象模式但 URL 路径为空"""
        response = {"status": "succeeded", "content": {}}
        mapping = {
            "single_mode": {
                "enabled": True,
                "url_path": "content.video_url",
            }
        }

        items = _extract_items(response, output_mapping=mapping)
        assert items == []

    def test_single_mode_disabled_falls_through(self):
        """single_mode.enabled=False 时不走单对象分支"""
        response = {"data": [{"url": "a"}]}
        mapping = {
            "single_mode": {"enabled": False, "url_path": "x"},
            "items_path": "data",
        }

        items = _extract_items(response, output_mapping=mapping)
        assert len(items) == 1


class TestExtractItemsArrayMode:
    """数组模式 output_mapping"""

    def test_items_path_extraction(self):
        response = {"result": {"videos": [{"download_url": "https://a.mp4"}]}}
        mapping = {"items_path": "result.videos"}

        items = _extract_items(response, output_mapping=mapping)
        assert len(items) == 1
        assert items[0]["download_url"] == "https://a.mp4"

    def test_items_path_with_schema_mapping(self):
        """数组模式 + item_schema 字段映射"""
        response = {
            "output": {
                "clips": [
                    {"download_url": "https://a.mp4", "thumb": "https://t.jpg", "s": 42},
                ]
            }
        }
        mapping = {
            "items_path": "output.clips",
            "item_schema": {
                "url": "$.download_url",
                "cover_url": "$.thumb",
                "seed": "$.s",
                "content_type": "video/mp4",  # 常量
            },
        }

        items = _extract_items(response, output_mapping=mapping)
        assert len(items) == 1
        assert items[0]["url"] == "https://a.mp4"
        assert items[0]["cover_url"] == "https://t.jpg"
        assert items[0]["seed"] == 42
        assert items[0]["content_type"] == "video/mp4"

    def test_items_path_not_list_returns_empty(self):
        response = {"result": {"videos": "not_a_list"}}
        mapping = {"items_path": "result.videos"}

        items = _extract_items(response, output_mapping=mapping)
        assert items == []
