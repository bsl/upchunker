class UploadController < ApplicationController
  MAX_FILE_SIZE = 2 * 1024 ** 3
  MAX_CHUNK_SIZE = 2 * 1024 ** 2
  MAX_FILE_NUM_CHUNKS = 2048

  def get
    return bad_request unless upload_id    = get_param_upload_id(params)
    return bad_request unless chunk_num    = get_param_chunk_num(params)
    return bad_request unless chunk_size   = get_param_chunk_size(params)
    return bad_request unless chunk_digest = get_param_chunk_digest(params)
    have_chunk = have_chunk?(upload_id, chunk_num, chunk_size, chunk_digest)
    render(body: nil, status: have_chunk ? 200 : 204)
  end

  def post
    case params["do"]
    when "start"
      handle_start
    when "chunk"
      handle_chunk
    when "finish"
      handle_finish
    else
      bad_request
    end
  end

  def have_chunk?(upload_id, chunk_num, chunk_size, chunk_digest)
    chunk_path = "/tmp/#{upload_id}/chunk.#{chunk_num}.#{chunk_digest}"
    File.exist?(chunk_path) && File.size(chunk_path) == chunk_size
  end

  def handle_start
    return bad_request unless file_name       = get_param_file_name(params)
    return bad_request unless file_size       = get_param_file_size(params)
    return bad_request unless file_num_chunks = get_param_file_num_chunks(params)
    return bad_request unless file_digest     = get_param_file_digest(params)

    if upload = Upload.where(
      file_name: file_name,
      file_size: file_size,
      file_num_chunks: file_num_chunks,
      file_digest: file_digest
    ).first
      return render(json: { "uploadId" => upload.uuid })
    end

    upload = Upload.new(
      file_name: file_name,
      file_size: file_size,
      file_num_chunks: file_num_chunks,
      file_digest: file_digest
    )
    upload.save
    render(json: { "uploadId" => upload.uuid })
  end

  def handle_chunk
    return bad_request unless upload_id    = get_param_upload_id(params)
    return bad_request unless chunk_num    = get_param_chunk_num(params)
    return bad_request unless chunk_size   = get_param_chunk_size(params)
    return bad_request unless chunk_digest = get_param_chunk_digest(params)
    return bad_request unless params["file"]

    return bad_request unless upload = Upload.where(uuid: upload_id).first
    return bad_request unless chunk_num <= upload.file_num_chunks
    return bad_request unless chunk_digest == calc_digest_of_chunk(params["file"])

    dir = "/tmp/#{upload_id}"
    FileUtils.mkdir_p(dir)
    chunk_path = "#{dir}/chunk.#{chunk_num}.#{chunk_digest}"
    FileUtils.mv(params["file"].tempfile, chunk_path)
    render(body: nil, status: 200)
  end

  def handle_finish
    return bad_request unless upload_id = get_param_upload_id(params)
    return bad_request unless upload = Upload.where(uuid: upload_id).first
    dir = "/tmp/#{upload_id}"
    if have_all_chunk_files?(upload, dir)
      store_file(upload, dir)
      FileUtils.rm_rf(dir)
      upload.destroy
      return render(body: nil, status: 200)
    end
    render(body: nil, status: 204)
  end

  RE_SHA256SUM = /\A[0-9a-f]{64}\z/
  RE_UUID_V4 = /\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

  def get_param_file_name(params)
    params["fileName"]
  end

  def get_param_file_size(params)
    x = params["fileSize"]
    n = x.to_i
    (n.to_s == x && n >= 0 && n <= MAX_FILE_SIZE) ? n : nil
  end

  def get_param_file_num_chunks(params)
    x = params["fileNumChunks"]
    n = x.to_i
    (n.to_s == x && n > 0 && n <= MAX_FILE_NUM_CHUNKS) ? n : nil
  end

  def get_param_chunk_num(params)
    x = params["chunkNum"]
    n = x.to_i
    (n.to_s == x && n > 0 && n <= MAX_FILE_NUM_CHUNKS) ? n : nil
  end

  def get_param_file_digest(params)
    x = params["fileDigest"]
    RE_SHA256SUM.match?(x) ? x : nil
  end

  def get_param_chunk_digest(params)
    x = params["chunkDigest"]
    RE_SHA256SUM.match?(x) ? x : nil
  end

  def get_param_upload_id(params)
    x = params["uploadId"]
    RE_UUID_V4.match?(x) ? x : nil
  end

  def get_param_chunk_size(params)
    x = params["chunkSize"]
    n = x.to_i
    (n.to_s == x && n > 0 && n <= MAX_CHUNK_SIZE) ? n : nil
  end

  def calc_digest_of_chunk(file)
    sha2 = Digest::SHA2.new
    sha2.update(file.read)
    sha2.hexdigest
  end

  def calc_digest_of_chunk_files(dir)
    sha2 = Digest::SHA2.new
    get_chunk_paths(dir).each do |path|
      data = File.read(path)
      sha2.update(data)
    end
    sha2.hexdigest
  end

  # Ordered by `chunk_num` ascending.
  def get_chunk_paths(dir)
    Dir.glob("#{dir}/chunk*").sort do |a, b|
      cna = a.match(/\/chunk\.(\d+)\./).captures[0].to_i
      cnb = b.match(/\/chunk\.(\d+)\./).captures[0].to_i
      cna <=> cnb
    end
  end

  def get_num_chunk_paths(dir)
    get_chunk_paths(dir).length
  end

  def calc_size_of_chunk_files(dir)
    get_chunk_paths(dir).sum { |f| File.size(f) }
  end

  def have_all_chunk_files?(upload, dir)
    File.directory?(dir) &&
      get_num_chunk_paths(dir) == upload.file_num_chunks &&
      calc_size_of_chunk_files(dir) == upload.file_size &&
      calc_digest_of_chunk_files(dir) == upload.file_digest
  end

  def store_file(upload, dir)
    dest_file_path = "/tmp/#{upload.uuid}.file"
    File.open(dest_file_path, "wb") do |f|
      get_chunk_paths(dir).each do |path|
        data = File.read(path)
        f.write(data)
      end
    end
    logger.debug("stored #{dest_file_path}")
  end

  def bad_request
    render(body: nil, status: 400)
  end

  def error
    render(body: nil, status: 500)
  end
end
