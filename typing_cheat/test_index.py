from html.parser import HTMLParser
from pathlib import Path
import unittest


class BookmarkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.bookmark = None
        self._reading_bookmark = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("id") == "autostart-bookmark":
            self.bookmark = {"href": attrs.get("href"), "text": ""}
            self._reading_bookmark = True

    def handle_data(self, data):
        if self._reading_bookmark:
            self.bookmark["text"] += data

    def handle_endtag(self, tag):
        if tag == "a" and self._reading_bookmark:
            self._reading_bookmark = False


class IndexBookmarkTest(unittest.TestCase):
    def test_autostart_bookmark_opens_game_with_start_flag(self):
        parser = BookmarkParser()
        parser.feed(Path(__file__).with_name("index.html").read_text(encoding="utf-8"))

        self.assertIsNotNone(parser.bookmark)
        self.assertEqual(
            parser.bookmark["href"],
            "https://otonasi-muonn.github.io/typing_game/?typingAutoStart=1",
        )
        self.assertIn("ネオンタイピングを開始", parser.bookmark["text"])


if __name__ == "__main__":
    unittest.main()
