-- Chat attachments can be up to 20 MB (GIFs, PDFs, voice notes). The browser uploads big ones straight to this bucket.
update storage.buckets set file_size_limit = 20971520 where id = 'chat-files';
