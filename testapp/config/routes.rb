Rails.application.routes.draw do
  get "upload" => "upload#get"
  post "upload" => "upload#post"
end
